/**
 * The Embodiment API — the Team Runner's contract with the outside world.
 *
 * Mounted at `/api/embodiment/v1` alongside the operator dashboard. Everything
 * an external client needs to give an agent a presence lives here: roster,
 * state, conversation, voice and face. See
 * `packages/contracts/openapi/embodiment.openapi.yaml`.
 */

import { readFile } from 'fs/promises';
import * as path from 'path';
import type { IncomingMessage, ServerResponse } from 'http';
import type { IAgent } from '../agent/iagent.js';
import type { TeamOrchestrator } from '../orchestrator/orchestrator.js';
import type { StoredEvent } from '../store/event-store.js';
import type { SpeechGateway } from '../speech/speech-gateway.js';
import { log } from '../util/logger.js';
import {
  badRequest, binary, fail, json, notFound, readJsonBody,
  matchRoute, MethodNotAllowed, get, post, put, del, noContent, type Route,
  SseHub, sendError,
} from '../../../packages/service-kit/src/index.js';
import { metaRoutes } from '../../../packages/service-kit/src/meta-routes.js';
import type { SendMessageRequest } from '../../../packages/contracts/src/types.js';
import { findAvatarByFile, framingOf } from '../render/avatar-catalogue.js';
import type { DeviceToolBridge, DeviceToolSpec, DeviceResult } from '../device/device-tool-bridge.js';
import { toEmbodiedAgent } from './agent-mapper.js';
import { mapOrchestratorEvent } from './event-mapper.js';
import { eventMatchesFilter, type EmbodimentEvent, type EmbodimentEventFilter } from './types.js';

export const EMBODIMENT_BASE = '/api/embodiment/v1';

const MAX_MESSAGE_LENGTH = 32_000;
const MAX_SPEECH_LENGTH = 4_000;

export interface EmbodimentProjectContext {
  id: string;
  name: string;
  goal: string;
  humanName: string;
  source: 'project-server' | 'local';
}

export interface EmbodimentRouterDeps {
  getOrchestrator(): TeamOrchestrator;
  getProjectContext(): EmbodimentProjectContext;
  activityFor(agentId: string): { activity: string; talkingTo?: string } | undefined;
  speech: SpeechGateway;
  avatarsDir: string;
  backgroundsDir: string;
  version: string;
  /** Tools that run on a connected device rather than on this machine. */
  devices: DeviceToolBridge;
}

export class EmbodimentRouter {
  private readonly deps: EmbodimentRouterDeps;
  private readonly hub = new SseHub<EmbodimentEvent, EmbodimentEventFilter>(eventMatchesFilter);
  private readonly routes: Route[];

  constructor(deps: EmbodimentRouterDeps) {
    this.deps = deps;
    this.routes = this.buildRoutes();
  }

  /** Feed one orchestrator event into the embodiment stream. */
  publishOrchestratorEvent(ev: StoredEvent): void {
    const orch = this.deps.getOrchestrator();
    const events = mapOrchestratorEvent(ev, {
      agentIdForName: (name) => orch.agentIdForName(name),
      activityFor: (id) => this.deps.activityFor(id),
      stateFor: (id) => orch.findById(id)?.state,
    });
    for (const event of events) this.hub.broadcast(event);
  }

  publish(event: EmbodimentEvent): void { this.hub.broadcast(event); }

  close(): void { this.hub.close(); }

  /** Returns true when the request was an embodiment route and has been handled. */
  async handleRoutes(pathname: string, method: string, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (!pathname.startsWith(EMBODIMENT_BASE)) return false;
    try {
      const match = matchRoute(this.routes, method, pathname);
      if (!match) { notFound(res, 'Embodiment route'); return true; }
      const url = new URL(req.url ?? '/', 'http://localhost');
      await match.route.handler({ req, res, url, params: match.params, query: url.searchParams });
    } catch (err) {
      if (err instanceof MethodNotAllowed) { fail(res, 405, err.message, 'method_not_allowed'); return true; }
      log.error('[Embodiment] Request error:', err);
      sendError(res, err);
    }
    return true;
  }

  // ── Routes ──────────────────────────────────────────────────────────────────

  private buildRoutes(): Route[] {
    const B = EMBODIMENT_BASE;
    return [
      ...metaRoutes({
        base: B,
        openApi: 'embodiment',
        health: () => ({
          service: 'team-runner-embodiment',
          version: this.deps.version,
          agentCount: this.deps.getOrchestrator().listAgents().length,
          speechAvailable: this.speechAvailable(),
        }),
      }),

      get(`${B}/project`, ({ res }) => {
        const ctx = this.deps.getProjectContext();
        json(res, 200, { ...ctx, agentCount: this.deps.getOrchestrator().listAgents().length });
      }),

      get(`${B}/agents`, async ({ res }) => json(res, 200, { agents: await this.roster() })),

      get(`${B}/agents/:agentId`, async ({ res, params }) => {
        const agent = this.findAgent(params['agentId'] as string);
        if (!agent) { notFound(res, 'Agent'); return; }
        json(res, 200, await this.embody(agent));
      }),

      get(`${B}/agents/:agentId/threads`, ({ res, params }) => {
        const agent = this.findAgent(params['agentId'] as string);
        if (!agent) { notFound(res, 'Agent'); return; }
        json(res, 200, { threads: agent.getThreadSummary() });
      }),

      get(`${B}/agents/:agentId/messages`, ({ res, params, query }) => {
        const agent = this.findAgent(params['agentId'] as string);
        if (!agent) { notFound(res, 'Agent'); return; }
        const thread = query.get('thread') ?? 'general';
        const limit = clamp(Number(query.get('limit') ?? 100), 1, 500);
        const since = query.get('since');

        let messages = agent.getThreadHistory(thread).map((m) => ({
          role: m.role,
          content: m.content,
          timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : String(m.timestamp),
          ...(m.toolName && { toolName: m.toolName }),
        }));
        if (since) messages = messages.filter((m) => m.timestamp > since);
        json(res, 200, { thread, messages: messages.slice(-limit) });
      }),

      post(`${B}/agents/:agentId/messages`, async ({ req, res, params }) => {
        const agent = this.findAgent(params['agentId'] as string);
        if (!agent) { notFound(res, 'Agent'); return; }
        const body = await readJsonBody<SendMessageRequest>(req);
        const content = body?.content?.trim();
        if (!content) { badRequest(res, 'content is required'); return; }
        if (content.length > MAX_MESSAGE_LENGTH) {
          badRequest(res, `content exceeds ${MAX_MESSAGE_LENGTH} characters`); return;
        }

        const thread = body?.thread?.trim() || 'general';
        const orch = this.deps.getOrchestrator();

        if (body?.mode === 'task') {
          await orch.humanAssignTask(agent.name, content, body.context);
        } else {
          await orch.humanMessage(agent.name, content, thread);
        }

        json(res, 202, {
          accepted: true,
          agentId: agent.id,
          thread,
          messageId: `${agent.id}:${Date.now()}`,
        });
      }),

      post(`${B}/agents/:agentId/tasks`, async ({ req, res, params }) => {
        const agent = this.findAgent(params['agentId'] as string);
        if (!agent) { notFound(res, 'Agent'); return; }
        const body = await readJsonBody<{ description?: string; context?: string }>(req);
        const description = body?.description?.trim();
        if (!description) { badRequest(res, 'description is required'); return; }
        const taskId = await this.deps.getOrchestrator().humanAssignTask(agent.name, description, body?.context);
        json(res, 202, { accepted: true, agentId: agent.id, taskId });
      }),

      post(`${B}/agents/:agentId/speech`, async (ctx) => this.handleSpeech(ctx.req, ctx.res, ctx.params['agentId'] as string)),

      get(`${B}/agents/:agentId/avatar`, async ({ res, params }) => {
        const agent = this.findAgent(params['agentId'] as string);
        const file = agent?.config.identity.avatar;
        if (!file) { notFound(res, 'Avatar'); return; }
        await this.sendAsset(res, this.deps.avatarsDir, file, 'model/gltf-binary');
      }),

      get(`${B}/agents/:agentId/background`, async ({ res, params }) => {
        const agent = this.findAgent(params['agentId'] as string);
        const file = (agent?.config.identity as { background?: string } | undefined)?.background;
        if (!file) { notFound(res, 'Background'); return; }
        await this.sendAsset(res, this.deps.backgroundsDir, file, 'image/png');
      }),

      /**
       * A device declares what it can do.
       *
       * Only the device knows — whether it has a camera, whether the user
       * granted it. Re-declaring replaces the list, so permission revoked is
       * permission withdrawn rather than a tool that fails for ever.
       */
      put(`${B}/devices/:deviceId`, async ({ req, res, params }) => {
        const deviceId = params['deviceId'] as string;
        const body = await readJsonBody<{ tools?: DeviceToolSpec[]; label?: string }>(req);
        if (!Array.isArray(body?.tools)) { badRequest(res, 'tools must be an array'); return; }
        this.deps.devices.register(deviceId, body.tools, body.label?.trim() || deviceId);
        json(res, 200, { deviceId, tools: body.tools.map((t) => t.name) });
      }),

      del(`${B}/devices/:deviceId`, ({ res, params }) => {
        this.deps.devices.unregister(params['deviceId'] as string);
        noContent(res);
      }),

      get(`${B}/devices`, ({ res }) => json(res, 200, { devices: this.deps.devices.connected() })),

      /** A device answering something it was asked. */
      post(`${B}/device-results/:requestId`, async ({ req, res, params }) => {
        const body = await readJsonBody<DeviceResult>(req);
        if (typeof body?.ok !== 'boolean') { badRequest(res, 'ok is required'); return; }
        const settled = this.deps.devices.settleResult(params['requestId'] as string, body);
        // A late answer is not an error on the device's part — it raced a
        // timeout — so it is reported rather than rejected.
        json(res, 200, { settled });
      }),

      get(`${B}/events`, async ({ res, query }) => {
        const agentId = query.get('agentId');
        const deviceId = query.get('deviceId');
        const filter = agentId || deviceId
          ? {
              ...(agentId && { agentId: this.findAgent(agentId)?.id ?? agentId }),
              ...(deviceId && { deviceId }),
            }
          : null;
        const project = this.deps.getProjectContext();

        // A device that drops its stream has gone, whatever it declared.
        // Leaving its tools on offer would hand the agent a camera that is
        // no longer there.
        if (deviceId) res.on('close', () => this.deps.devices.unregister(deviceId));

        this.hub.subscribe(res, filter, {
          type: 'hello',
          agents: await this.roster(),
          project: { id: project.id, name: project.name, goal: project.goal },
        });
      }),
    ];
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private async roster() {
    return Promise.all(this.deps.getOrchestrator().listAgents().map((agent) => this.embody(agent)));
  }

  /**
   * One agent in contract form, with its avatar framing attached. The
   * catalogue lookup is cached against the file mtime, so this stays cheap
   * even when the whole roster asks for it at once.
   */
  private async embody(agent: IAgent) {
    const entry = await findAvatarByFile(this.deps.avatarsDir, agent.config.identity.avatar);
    return toEmbodiedAgent(agent, this.deps.activityFor(agent.id), framingOf(entry));
  }

  /** Accepts an instance id or, for convenience, an agent name. */
  private findAgent(idOrName: string): IAgent | undefined {
    const orch = this.deps.getOrchestrator();
    const byId = orch.findById(idOrName);
    if (byId) return byId;
    const needle = idOrName.toLowerCase();
    return orch.listAgents().find((a) => a.name.toLowerCase() === needle);
  }

  private speechAvailable(): boolean {
    return this.deps.speech.isAvailable();
  }

  private async sendAsset(res: ServerResponse, dir: string, file: string, mime: string): Promise<void> {
    const target = path.resolve(dir, path.basename(file));
    if (!target.startsWith(path.resolve(dir))) { notFound(res, 'Asset'); return; }
    try {
      binary(res, 200, await readFile(target), mime, { 'Cache-Control': 'public, max-age=3600' });
    } catch {
      notFound(res, 'Asset');
    }
  }

  private async handleSpeech(req: IncomingMessage, res: ServerResponse, agentId: string): Promise<void> {
    const agent = this.findAgent(agentId);
    if (!agent) { notFound(res, 'Agent'); return; }

    const body = await readJsonBody<{ text?: string; withVisemes?: boolean }>(req);
    const text = body?.text?.trim();
    if (!text) { badRequest(res, 'text is required'); return; }
    if (text.length > MAX_SPEECH_LENGTH) { badRequest(res, `text exceeds ${MAX_SPEECH_LENGTH} characters`); return; }
    if (!this.speechAvailable()) {
      fail(res, 503, 'No TTS voice is configured on this runner', 'speech_unavailable');
      return;
    }

    const chunks: Array<{ audioBase64: string; visemes: unknown[]; duration: number; sentence: string }> = [];
    // Each sentence is broadcast as it renders, so a listening client can begin
    // playing before the whole utterance exists.
    await this.deps.speech.speak(text, agent.name, agent.config.identity.voice, agent.config.identity.speakerName, (chunk) => {
      chunks.push(chunk);
      this.hub.broadcast({
        type: 'agent_speech',
        agentId: agent.id,
        name: agent.name,
        sentence: chunk.sentence,
        audioBase64: chunk.audioBase64,
        visemes: chunk.visemes,
        durationMs: Math.round(chunk.duration * 1000),
        chunk: chunk.id,
        totalChunks: chunk.totalChunks,
      });
    });

    if (chunks.length === 0) { fail(res, 503, 'Speech synthesis produced no audio', 'speech_failed'); return; }

    if (body?.withVisemes) {
      json(res, 200, {
        mimeType: 'audio/wav',
        durationMs: Math.round(chunks.reduce((total, c) => total + c.duration, 0) * 1000),
        chunks: chunks.map((c) => ({
          sentence: c.sentence,
          audioBase64: c.audioBase64,
          durationMs: Math.round(c.duration * 1000),
          visemes: c.visemes,
        })),
      });
      return;
    }

    // Raw WAV: return the first sentence's audio, which is what a simple
    // <audio> client can play without stitching chunks together.
    binary(res, 200, Buffer.from(chunks[0]!.audioBase64, 'base64'), 'audio/wav');
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

