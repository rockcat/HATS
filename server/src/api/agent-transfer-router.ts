// Save, load, duplicate and send one running agent, and make a template of it.
//
//   POST /api/agents/:name/duplicate    { name }                       → a copy here
//   GET  /api/agents/:name/export[?credentials=true]                   → application/zip
//   POST /api/agents/import?name=<name>  ← application/zip             → a new agent here
//   POST /api/agents/:name/send         { url, apiKey, name?, credentials? } → another runner's import
//   POST /api/agents/:name/to-library   { name }                       → a new library template
//
// Anything that can carry logins off this machine, or write them onto it, is
// admin-only, as a project export and import are.

import type { IncomingMessage, ServerResponse } from 'http';
import * as path from 'path';
import { log } from '../../../packages/core/src/logger.js';
import type { TeamOrchestrator } from '../orchestrator/orchestrator.js';
import { assignedActionIds } from '../orchestrator/agent-definition.js';
import { ArchiveError } from '../project/project-archive.js';
import { packAgent, unpackAgent } from '../agent-transfer/agent-bundle.js';
import {
  AgentNameTaken, captureAgent, restoreAgent, templateFrom, type AgentTarget,
} from '../agent-transfer/agent-transfer.js';
import { EXTERNAL_PROVIDER } from '../agent/external-agent.js';
import { AnthropicProvider } from '../providers/anthropic.js';
import { makeProvider } from './providers.js';
import { assignScheduledActions } from './project-agents.js';
import type { AgentDefinitionStore } from './agent-store.js';
import type { ScheduledActionStore } from './scheduled-action-store.js';

/** A large memory or long history still arrives well within this; the other runner is just a runner. */
const SEND_TIMEOUT_MS = 120_000;

export interface AgentTransferRouterDeps {
  getOrchestrator(): TeamOrchestrator;
  getAgentStore(): AgentDefinitionStore | null;
  getActionStore(): ScheduledActionStore | null;
  /** The data directory, which holds avatars/. */
  dataRoot: string;
  resolveAgentName(name: string): string;
  isAdmin(req: IncomingMessage): boolean;
  /** Tell the dashboard the team changed, and save it. */
  agentsChanged(): void;
  json(res: ServerResponse, status: number, body: unknown): void;
  readBody(req: IncomingMessage): Promise<string>;
  readBodyBuffer(req: IncomingMessage): Promise<Buffer>;
}

const ACTION = /^\/api\/agents\/([^/]+)\/(duplicate|export|send|to-library)$/;

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export class AgentTransferRouter {
  constructor(private readonly deps: AgentTransferRouterDeps) {}

  async handleRoutes(pathname: string, method: string, url: URL, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const isImport = pathname === '/api/agents/import' && method === 'POST';
    const match = ACTION.exec(pathname);
    const action = match?.[2];
    if (!isImport && !(match && (action === 'export' ? method === 'GET' : method === 'POST'))) return false;

    try {
      if (isImport) await this.import(url, req, res);
      else await this.act(action!, decodeURIComponent(match![1]!), url, req, res);
    } catch (err) {
      const status = err instanceof HttpError ? err.status
        : err instanceof AgentNameTaken ? 409
        : err instanceof ArchiveError ? 400
        : 500;
      if (status === 500) log.error(`[Agent transfer] ${(err as Error).stack ?? err}`);
      // The name tried, so the page can suggest one that is free.
      this.deps.json(res, status, { error: (err as Error).message, ...(err instanceof AgentNameTaken && { name: err.takenName }) });
    }
    return true;
  }

  private requireAdmin(req: IncomingMessage, what: string): void {
    if (!this.deps.isAdmin(req)) throw new HttpError(403, `Only an admin can ${what}`);
  }

  private async act(action: string, name: string, url: URL, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const orch = this.deps.getOrchestrator();
    const agent = orch.getAgent(this.deps.resolveAgentName(name));
    if (!agent) throw new HttpError(404, `There is no agent called "${name}"`);
    const capture = (includeCredentials: boolean) => captureAgent({
      agent,
      scheduledActionIds: assignedActionIds(orch.getAgendaStore(), agent.name),
      agentDir: orch.agentDir(agent.name),
      dataRoot: this.deps.dataRoot,
      actions: { get: (id) => this.deps.getActionStore()?.get(id) },
    }, { includeCredentials });

    if (action === 'duplicate') {
      const body = JSON.parse((await this.deps.readBody(req)) || '{}') as { name?: string };
      // The same machine, so its logins go with it, as every other setting does.
      const report = await restoreAgent(this.target(), await capture(true), { name: body.name ?? '' });
      this.deps.agentsChanged();
      log.info(`[Agent transfer] Duplicated ${agent.name} as ${report.name}`);
      this.deps.json(res, 201, report);
      return;
    }

    if (action === 'export') {
      const includeCredentials = url.searchParams.get('credentials') === 'true';
      if (includeCredentials) this.requireAdmin(req, 'save an agent with its logins');
      const bytes = await packAgent(await capture(includeCredentials));
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Length': bytes.length,
        'Content-Disposition': `attachment; filename="${agent.name.replace(/[^A-Za-z0-9_-]/g, '_')}.hats-agent.zip"`,
      });
      res.end(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
      return;
    }

    if (action === 'send') {
      this.requireAdmin(req, 'send an agent to another runner');
      const body = JSON.parse((await this.deps.readBody(req)) || '{}') as {
        url?: string; apiKey?: string; name?: string; credentials?: boolean;
      };
      const remote = importUrl(body.url ?? '', body.name?.trim() || agent.name);
      if (!body.apiKey?.trim()) throw new HttpError(400, 'An API key for the other runner is needed');
      const bytes = await packAgent(await capture(body.credentials === true));
      const answer = await fetch(remote, {
        method: 'POST',
        headers: { Authorization: `Bearer ${body.apiKey.trim()}`, 'Content-Type': 'application/zip' },
        body: new Blob([new Uint8Array(bytes)], { type: 'application/zip' }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      }).catch((err: Error & { cause?: Error }) => {
        throw new HttpError(502, `Could not reach ${remote.origin}: ${err.cause?.message ?? err.message}`);
      });
      const reply = await answer.json().catch(() => ({})) as { error?: string; name?: string };
      if (answer.ok) log.info(`[Agent transfer] Sent ${agent.name} to ${remote.origin}`);
      // Passed on as it came, so a name taken there can be asked about here.
      this.deps.json(res, answer.ok ? 201 : answer.status === 401 || answer.status === 403 ? 502 : answer.status,
        answer.ok ? reply : {
          error: `${remote.origin} said: ${reply.error ?? answer.statusText}`,
          remoteStatus: answer.status,
          ...(reply.name && { name: reply.name }),
        });
      return;
    }

    // to-library
    const store = this.deps.getAgentStore();
    if (!store) throw new HttpError(503, 'The Agent Library is not available');
    const body = JSON.parse((await this.deps.readBody(req)) || '{}') as { name?: string };
    const templateName = body.name?.trim() || agent.name;
    if (store.list().some((t) => t.identity.name.toLowerCase() === templateName.toLowerCase())) {
      throw new HttpError(409, `The library already has a template called "${templateName}"`);
    }
    const { definition } = await capture(false);
    const template = await store.addOrUpdate(templateFrom(definition, templateName));
    log.info(`[Agent transfer] ${agent.name} added to the library as ${template.identity.name}`);
    this.deps.json(res, 201, { id: template.id, name: template.identity.name });
  }

  private async import(url: URL, req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.requireAdmin(req, 'load an agent');
    const body = await this.deps.readBodyBuffer(req);
    if (body.length === 0) throw new HttpError(400, 'Send the saved agent as the request body');
    const bundle = await unpackAgent(new Uint8Array(body));
    const report = await restoreAgent(this.target(), bundle, { name: url.searchParams.get('name') || bundle.manifest.name });
    this.deps.agentsChanged();
    log.info(`[Agent transfer] Loaded ${report.name}${bundle.credentials ? ', with its logins' : ''}`);
    this.deps.json(res, 201, report);
  }

  private target(): AgentTarget {
    const orch = this.deps.getOrchestrator();
    const projectDir = orch.getProjectDir();
    return {
      hasAgentNamed: (n) => orch.listAgents().some((a) => a.name.toLowerCase() === n.toLowerCase()),
      providerFor: (def) => (def.externalEndpoint || def.providerName === 'external'
        ? EXTERNAL_PROVIDER
        : makeProvider(def.providerName) ?? new AnthropicProvider()),
      register: (config) => orch.registerAgent(config),
      agentDirFor: (id) => (projectDir ? path.join(projectDir, 'agents', id) : undefined),
      dataRoot: this.deps.dataRoot,
      actions: {
        addIfMissing: async (def) => this.deps.getActionStore()?.addIfMissing(def) ?? false,
      },
      assignActions: (agentName, ids) =>
        assignScheduledActions(orch.getAgendaStore(), this.deps.getActionStore(), agentName, ids),
    };
  }
}

/** The other runner's import address, from what was typed: its base address. */
export function importUrl(base: string, name: string): URL {
  let url: URL;
  try { url = new URL(base.trim()); } catch { throw new HttpError(400, `"${base}" is not an address`); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new HttpError(400, 'The address must start http:// or https://');
  const target = new URL('/api/agents/import', url.origin);
  target.searchParams.set('name', name);
  return target;
}
