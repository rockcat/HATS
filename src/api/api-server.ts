import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFile, writeFile, rename, mkdir, readdir, stat } from 'fs/promises';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { TeamOrchestrator } from '../orchestrator/orchestrator.js';
import { StoredEvent } from '../store/event-store.js';
import { Board } from '../mcp/kanban/types.js';
import { Task, Meeting, MeetingType } from '../orchestrator/types.js';
import { MCP_CATALOGUE, resolveConfig } from '../mcp/mcp-catalogue.js';
import { debugState } from '../providers/debug-state.js';
import { AnthropicProvider } from '../providers/anthropic.js';
import { OpenAIProvider, OllamaProvider, LMStudioProvider } from '../providers/openai.js';
import { GeminiProvider } from '../providers/gemini.js';
import { AIProvider } from '../providers/types.js';
import { HatType } from '../hats/types.js';
import { readEnvFile, writeEnvFile } from './env-manager.js';
import { getPricingTable, FREE_PROVIDERS } from '../providers/pricing.js';
import { processSpeech, isSpeechAvailable } from '../speech/pipeline.js';
import { VoiceManager } from '../speech/voice-manager.js';
import { SPECIALISATION_DIRECTIVES, generateSystemPrompt } from '../prompt/generator.js';
import { getHatDefinition } from '../hats/definitions.js';
import { TelemetryStore } from '../store/telemetry-store.js';
import { log } from '../util/logger.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
// Static files live in src/webui/public/ — one level up from src/api/
const PUBLIC_DIR = path.join(__dirname, '..', 'webui', 'public');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.glb':  'model/gltf-binary',
  '.json': 'application/json',
};

const AVATARS_DIR     = path.join(process.cwd(), 'avatars');
const BACKGROUNDS_DIR = path.join(process.cwd(), 'avatars', 'backgrounds');
// Serve Three.js (and any other npm packages) from local node_modules to avoid CDN dependency
const NM_DIR          = path.join(process.cwd(), 'node_modules');

// ── Types ─────────────────────────────────────────────────────────────────────

interface AgentStatus {
  name:             string;
  hatType:          string;
  state:            string;
  activity:         string;
  talkingTo?:       string;
  model?:           string;
  provider?:        string;
  specialisation?:  string;
  visualDescription?: string;
  backstory?:       string;
  avatar?:          string;
  voice?:           string;
  speakerName?:     string;
}

// ── Config ────────────────────────────────────────────────────────────────────

/**
 * Factory that builds (or restores) a TeamOrchestrator for a given project folder.
 * Called both on initial startup and whenever the user switches projects.
 */
export type ProjectLoader = (projectDir: string, kanbanFile: string, stateFile: string) => Promise<TeamOrchestrator>;

export interface APIServerConfig {
  port?:            number;   // default 3001
  kanbanPath?:      string;   // path to kanban-board.json; omit to disable kanban endpoints
  mcpEnabledPath?:  string;   // path to persist enabled MCP servers; default './mcp-enabled.json'
  meetingsPath?:    string;   // path to meetings.json; omit to disable calendar endpoints
  envPath?:         string;   // path to .env file for settings editor; default './.env'
  projectId?:       string;   // current project identifier
  projectDir?:      string;   // absolute path to the current project folder
  projectsRoot?:    string;   // absolute path to the projects root folder
  projectLoader?:   ProjectLoader;  // factory used for in-process project switching
}

// ── Server ────────────────────────────────────────────────────────────────────

export class APIServer {
  private server;
  private wss: WebSocketServer;
  private orchestrator: TeamOrchestrator;
  private kanbanPath: string | null;
  private port: number;
  private mcpEnabledPath: string;
  private envPath: string;
  private projectId: string;
  private projectDir: string | null;
  private projectsRoot: string | null;
  private projectLoader: ProjectLoader | null;
  private projectSwitchCallback: ((orchestrator: TeamOrchestrator) => void) | null = null;
  private enabledMCPIds: Set<string> = new Set();
  private meetingsPath: string | null;
  private meetingScheduler: ReturnType<typeof setInterval> | null = null;

  // SSE clients (browser dashboard)
  private sseClients: ServerResponse[] = [];

  // Agent activity layer — updated from orchestrator events
  private agentActivity = new Map<string, { activity: string; talkingTo?: string }>();
  private talkingTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // Maps agent name (lowercase) → kanban ticket id they're working on
  private agentTicketMap = new Map<string, string>();

  // Per-agent event feed (last 200 events per agent)
  private agentFeeds = new Map<string, StoredEvent[]>();
  private readonly FEED_LIMIT = 200;

  // Kanban file watcher
  private kanbanWatcher: fs.FSWatcher | null = null;
  private kanbanDebounce: ReturnType<typeof setTimeout> | null = null;

  // Periodic nudge for stale tickets
  private nudgeScheduler: ReturnType<typeof setInterval> | null = null;

  private unsubscribeEvents: (() => void) | null = null;

  // Which agent name + voice URL each WS client wants speech for
  private speechInterest = new Map<WebSocket, { agentName: string; voiceUrl: string | null; speakerId: number | null }>();

  private voiceManager = new VoiceManager();
  private telemetry: TelemetryStore | null = null;

  // Pending human turns in active meetings: meetingId → resolve fn
  private pendingHumanTurns = new Map<string, (input: string | null) => void>();

  constructor(orchestrator: TeamOrchestrator, config: APIServerConfig = {}) {
    this.orchestrator = orchestrator;
    this.kanbanPath   = config.kanbanPath ?? null;
    this.port         = config.port ?? 3001;
    this.mcpEnabledPath = config.mcpEnabledPath ?? './mcp-enabled.json';
    this.meetingsPath   = config.meetingsPath ?? null;
    this.envPath        = config.envPath ?? './.env';
    this.projectId      = config.projectId ?? 'default';
    this.projectDir     = config.projectDir ?? null;
    this.projectsRoot   = config.projectsRoot ?? null;
    this.projectLoader  = config.projectLoader ?? null;

    this.server = createServer((req, res) => {
      this.handleRequest(req, res).catch((err) => {
        log.error('[API] Request error:', err);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: (err as Error).message ?? 'Internal error' }));
        }
      });
    });
    this.wss = new WebSocketServer({ server: this.server });
    this.wss.on('connection', (ws) => this.handleWsConnection(ws));
  }

  /** Register a callback invoked whenever the active project (and orchestrator) changes. */
  onProjectSwitch(cb: (orchestrator: TeamOrchestrator) => void): void {
    this.projectSwitchCallback = cb;
  }

  async start(): Promise<void> {
    // Start Piper voice servers (async — voices ready before any agent responds)
    this.voiceManager.start().catch((err: Error) =>
      log.warn('[API] VoiceManager start error:', err.message),
    );

    // Ensure project folder structure exists
    if (this.projectDir) {
      await this.ensureProjectFolders(this.projectDir);
      this.orchestrator.setProjectDir(this.projectDir);
      const goal = await this.getProjectGoal();
      if (goal) this.orchestrator.setProjectGoal(goal);
      const humanName = await this.getProjectMeta('humanName');
      if (humanName) this.orchestrator.setHumanName(humanName);
    }

    // Init telemetry store (project-scoped if projectDir is set)
    const telemetryPath = this.projectDir
      ? path.join(this.projectDir, 'telemetry.jsonl')
      : path.join(process.cwd(), 'data', 'telemetry.jsonl');
    await this.initTelemetryStore(telemetryPath);

    // Subscribe to orchestrator events
    this.unsubscribeEvents = this.orchestrator.onEvent((ev) => {
      this.handleOrchestratorEvent(ev);
      this.wsBroadcast(ev);
    });

    // Wire human meeting turn — browser resolves via POST /api/meetings/:id/human-turn
    this.orchestrator.setHumanMeetingTurnHandler(async (meetingId, _turns, topic) => {
      this.sseBroadcast({ type: 'meeting_human_turn', meetingId, topic });
      return new Promise<string | null>((resolve) => {
        this.pendingHumanTurns.set(meetingId, resolve);
        // Auto-pass after 5 minutes
        setTimeout(() => {
          if (this.pendingHumanTurns.delete(meetingId)) resolve(null);
        }, 5 * 60 * 1000);
      });
    });

    // Load persisted MCP state
    this.loadMCPEnabled().catch(() => {});

    // Init scheduled-meeting store
    if (this.meetingsPath) {
      this.orchestrator.initMeetingStore(this.meetingsPath).catch(() => {});
    }

    // 60-second scheduler: launch any due meetings
    this.meetingScheduler = setInterval(() => {
      this.launchDueMeetings().catch(() => {});
    }, 60_000);

    // Assign avatars/backgrounds to agents that don't have them yet
    if (this.projectDir) this.assignDefaultVisuals().catch(() => {});

    // Dispatch any in_progress kanban tickets that have no active orchestrator task
    if (this.kanbanPath) this.dispatchUnstartedTickets().catch(() => {});

    // Periodic nudge: every 30 minutes, remind agents about stale in_progress/blocked tickets
    this.nudgeScheduler = setInterval(() => {
      this.nudgeStaleTickets().catch(() => {});
    }, 30 * 60 * 1000);

    // Watch kanban file
    if (this.kanbanPath) this.watchKanban(this.kanbanPath);

    this.server.listen(this.port, () => {
      log.info(`[API] UI    http://localhost:${this.port}`);
      log.info(`[API] REST  http://localhost:${this.port}/api`);
      log.info(`[API] WS    ws://localhost:${this.port}/ws`);
      if (isSpeechAvailable() || this.voiceManager.getVoices().length > 0) {
        const voices = this.voiceManager.getVoices();
        if (voices.length > 0) {
          log.info(`[API] Speech TTS — ${voices.length} voice(s): ${voices.map(v => v.name).join(', ')}`);
        } else {
          log.info(`[API] Speech TTS enabled (model: ${process.env['PIPER_MODEL'] ?? 'server'})`);
        }
      }
    });
  }

  stop(): void {
    this.unsubscribeEvents?.();
    this.kanbanWatcher?.close();
    if (this.meetingScheduler) { clearInterval(this.meetingScheduler); this.meetingScheduler = null; }
    if (this.nudgeScheduler)   { clearInterval(this.nudgeScheduler);   this.nudgeScheduler   = null; }
    this.voiceManager.stop();
    this.wss.close();
    this.server.close();
  }

  // ── WebSocket (raw event stream for programmatic clients) ─────────────────

  private handleWsConnection(ws: WebSocket): void {
    const snapshot = this.buildTeamSnapshot();
    ws.send(JSON.stringify({ type: 'snapshot', data: snapshot }));

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type: string; name?: string; voice?: string; speakerName?: string };
        if (msg.type === 'set_speech_agent') {
          if (msg.name) {
            const voice    = this.voiceManager.resolveVoice(msg.voice);
            const voiceUrl = voice?.url ?? process.env['PIPER_SERVER_URL'] ?? null;
            // Resolve speaker name → integer id; fall back to voice default
            let speakerId: number | null = voice?.speakerId ?? null;
            if (msg.speakerName && voice) {
              const found = voice.speakers.find(s => s.name === msg.speakerName);
              if (found) speakerId = found.id;
            }
            this.speechInterest.set(ws, { agentName: msg.name, voiceUrl, speakerId });
          } else {
            this.speechInterest.delete(ws);
          }
        }
      } catch { /* ignore malformed */ }
    });

    ws.on('close', () => this.speechInterest.delete(ws));
    ws.on('error', () => {});
  }

  private wsBroadcast(event: StoredEvent): void {
    const msg = JSON.stringify({ type: 'event', data: event });
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    }
  }

  // ── SSE (browser dashboard) ───────────────────────────────────────────────

  private async sseInit(res: ServerResponse): Promise<void> {
    res.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    const agents     = this.buildAgentStatuses();
    const tickets    = this.kanbanPath ? await this.readTickets() : [];
    const meta       = await this.readProjectMeta();
    const project    = { id: this.projectId, dir: this.projectDir, goal: meta['goal'] ?? '', humanName: meta['humanName'] ?? 'Human' };
    res.write(`data: ${JSON.stringify({ type: 'init', agents, tickets, project })}\n\n`);
    this.sseClients.push(res);
  }

  private sseBroadcast(data: object): void {
    const msg = `data: ${JSON.stringify(data)}\n\n`;
    for (let i = this.sseClients.length - 1; i >= 0; i--) {
      try { this.sseClients[i].write(msg); }
      catch { this.sseClients.splice(i, 1); }
    }
  }

  // ── Agent activity tracking ───────────────────────────────────────────────

  private handleOrchestratorEvent(ev: StoredEvent): void {
    let changed = false;

    switch (ev.type) {
      case 'task_assigned': {
        const to = ev['to'] as string | undefined;
        const task = ev['task'] as string | undefined;
        if (to) {
          this.setActivity(to, task ?? 'Working on task');
          changed = true;
        }
        break;
      }
      case 'direct_message': {
        const from = ev['from'] as string | undefined;
        const to   = ev['to'] as string | undefined;
        if (from && to) {
          this.setActivity(from, `Messaging ${to}…`, to);
          // Clear talkingTo after 5s
          const prev = this.talkingTimers.get(from);
          if (prev) clearTimeout(prev);
          this.talkingTimers.set(from, setTimeout(() => {
            const cur = this.agentActivity.get(from);
            if (cur) { cur.talkingTo = undefined; this.sseBroadcast({ type: 'agent_update', agents: this.buildAgentStatuses() }); }
          }, 5000));
          changed = true;
        }
        break;
      }
      case 'agent_response': {
        const from    = ev['from'] as string | undefined;
        const content = ev['content'] as string | undefined;
        if (from) {
          this.setActivity(from, (content ?? '').trim() || 'Responded');
          changed = true;
          this.sseBroadcast({ type: 'cli_output', kind: 'agent', from, content: content ?? '' });

          // Speech synthesis — send to any WS client interested in this agent
          const hasSpeech = this.voiceManager.getVoices().length > 0 || isSpeechAvailable();
          if (content && hasSpeech) {
            const interested = [...this.speechInterest.entries()]
              .filter(([, info]) => info.agentName === from);
            if (interested.length > 0) {
              // Group by voiceUrl so identical voices share one pipeline run
              const byVoice = new Map<string | null, WebSocket[]>();
              for (const [ws, { voiceUrl }] of interested) {
                const key = voiceUrl ?? null;
                if (!byVoice.has(key)) byVoice.set(key, []);
                byVoice.get(key)!.push(ws);
              }
              for (const [voiceUrl, clients] of byVoice) {
                const speakerId = interested.find(([ws]) => clients.includes(ws))?.[1]?.speakerId ?? null;
                processSpeech(content, from, voiceUrl, speakerId, (chunk) => {
                  const msg = JSON.stringify({ type: 'speech_chunk', data: chunk });
                  for (const ws of clients) {
                    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
                  }
                }).catch((err: Error) =>
                  log.warn(`[Speech] Pipeline error for ${from}:`, err.message),
                );
              }
            }
          }
        }
        break;
      }
      case 'task_complete': {
        const agent = ev['agent'] as string | undefined;
        if (agent) {
          this.setActivity(agent, 'Task complete');
          changed = true;
          const ticketId = this.agentTicketMap.get(agent.toLowerCase());
          if (ticketId) {
            this.updateKanbanColumn(ticketId, 'completed').catch(() => {});
            this.agentTicketMap.delete(agent.toLowerCase());
          }
        }
        break;
      }
      case 'meeting_started': {
        const facilitator  = ev['facilitator'] as string | undefined;
        const participants = ev['participants'] as string[] | undefined;
        const topic        = ev['topic'] as string | undefined;
        const meetingId    = ev['meetingId'] as string | undefined;
        const label = `Meeting: ${(topic ?? '').slice(0, 50)}`;
        for (const name of [facilitator, ...(participants ?? [])].filter(Boolean) as string[]) {
          this.setActivity(name, label);
        }
        const hasHuman = (participants ?? []).includes('human');
        this.sseBroadcast({ type: 'meeting_started', meetingId, topic, facilitator, participants, hasHuman });
        changed = true;
        break;
      }
      case 'meeting_turn': {
        const meetingId   = ev['meetingId'] as string | undefined;
        const participant = ev['participant'] as string | undefined;
        const content     = ev['content'] as string | undefined;
        this.sseBroadcast({ type: 'meeting_turn', meetingId, participant, content });
        break;
      }
      case 'meeting_closed': {
        const meetingId = ev['meetingId'] as string | undefined;
        const topic     = ev['topic'] as string | undefined;
        this.sseBroadcast({ type: 'meeting_closed', meetingId, topic });
        // Resolve any pending human turn (so the waiting promise unblocks)
        const resolver = this.pendingHumanTurns.get(meetingId ?? '');
        if (resolver) { this.pendingHumanTurns.delete(meetingId!); resolver(null); }
        break;
      }
      case 'escalation': {
        const from    = ev['from'] as string | undefined;
        const message = ev['message'] as string | undefined;
        const urgency = ev['urgency'] as string | undefined;
        if (from) {
          this.setActivity(from, 'Waiting for human…');
          changed = true;
          this.sseBroadcast({ type: 'cli_output', kind: 'escalation', from, content: message ?? '' });
          const ticketId = this.agentTicketMap.get(from.toLowerCase());
          if (ticketId) {
            this.updateKanbanColumn(ticketId, 'blocked').catch(() => {});
            if (message) this.addTicketComment(ticketId, from, `Blocked: ${message}`).catch(() => {});
          }
          // Create a human-assigned ticket for the escalation
          this.createEscalationTicket(from, message ?? '', urgency ?? 'medium').catch(() => {});
        }
        break;
      }
      case 'mcp_server_added':
        this.sseBroadcast({ type: 'tools_update', tools: this.orchestrator.getToolInfo() });
        break;
    }

    if (changed) {
      this.sseBroadcast({ type: 'agent_update', agents: this.buildAgentStatuses() });
    }

    this.bufferAgentFeedEvent(ev);
  }

  private bufferAgentFeedEvent(ev: StoredEvent): void {
    const targets: string[] = [];

    switch (ev.type) {
      case 'tool_call':
      case 'tool_result':
      case 'tool_error':
      case 'task_complete':
        { const a = ev['agent'] as string | undefined; if (a) targets.push(a); break; }
      case 'agent_response':
      case 'escalation':
        { const f = ev['from'] as string | undefined; if (f) targets.push(f); break; }
      case 'direct_message':
        { const f = ev['from'] as string | undefined; if (f) targets.push(f);
          const t = ev['to']   as string | undefined; if (t && t !== 'human') targets.push(t); break; }
      case 'task_assigned':
        { const t = ev['to']   as string | undefined; if (t) targets.push(t);
          const f = ev['from'] as string | undefined; if (f && f !== 'human') targets.push(f); break; }
      case 'human_message':
      case 'human_reply':
        { const t = ev['to'] as string | undefined; if (t) targets.push(t); break; }
    }

    for (const name of [...new Set(targets)]) {
      const key = name.toLowerCase();
      if (!this.agentFeeds.has(key)) this.agentFeeds.set(key, []);
      const buf = this.agentFeeds.get(key)!;
      buf.push(ev);
      if (buf.length > this.FEED_LIMIT) buf.shift();
      this.sseBroadcast({ type: 'agent_stream', agent: name, event: ev });
    }
  }

  private setActivity(name: string, activity: string, talkingTo?: string): void {
    this.agentActivity.set(name, { activity, talkingTo });
  }

  private buildAgentStatuses(): AgentStatus[] {
    return this.orchestrator.listAgents().map((a) => {
      const extra = this.agentActivity.get(a.name);
      return {
        name:             a.name,
        hatType:          a.hatType,
        state:            a.state,
        activity:         extra?.activity ?? stateLabel(a.state),
        talkingTo:        extra?.talkingTo,
        model:            a.config.model,
        provider:         a.config.provider.name,
        specialisation:   a.config.identity.specialisation,
        visualDescription: a.config.identity.visualDescription,
        backstory:        a.config.identity.backstory,
        avatar:           a.config.identity.avatar,
        background:       a.config.identity.background,
        voice:            a.config.identity.voice,
        speakerName:      a.config.identity.speakerName,
      };
    });
  }

  // ── Kanban file watcher ───────────────────────────────────────────────────

  private watchKanban(filePath: string): void {
    try {
      this.kanbanWatcher = fs.watch(filePath, () => {
        if (this.kanbanDebounce) clearTimeout(this.kanbanDebounce);
        this.kanbanDebounce = setTimeout(async () => {
          try {
            const tickets = await this.readTickets();
            this.sseBroadcast({ type: 'kanban_update', tickets });
          } catch { /* file may be mid-write */ }
        }, 150);
      });
    } catch {
      // File may not exist yet — watcher will be set up on next write
    }
  }

  private async readTickets() {
    if (!this.kanbanPath) return [];
    const board = await this.readKanban();
    return Object.values(board.tickets);
  }

  // ── HTTP routing ──────────────────────────────────────────────────────────

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const url      = new URL(req.url ?? '/', `http://localhost:${this.port}`);
    const pathname = url.pathname;

    // SSE endpoint — used by browser dashboard
    if (pathname === '/events' && req.method === 'GET') {
      await this.sseInit(res);
      req.on('close', () => {
        const i = this.sseClients.indexOf(res);
        if (i >= 0) this.sseClients.splice(i, 1);
      });
      return;
    }

    if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'PATCH' && req.method !== 'DELETE' && req.method !== 'PUT') {
      this.json(res, 405, { error: 'Method not allowed' }); return;
    }

    // ── REST API ─────────────────────────────────────────────────────────────

    if (pathname.startsWith('/api/agents/') && pathname.endsWith('/feed')) {
      const name = decodeURIComponent(pathname.slice('/api/agents/'.length, -'/feed'.length));
      this.json(res, 200, this.agentFeeds.get(name.toLowerCase()) ?? []);

    } else if (pathname === '/api/team') {
      this.json(res, 200, this.buildTeamSnapshot());

    } else if (pathname === '/api/agents') {
      this.json(res, 200, this.buildAgentStatuses());

    } else if (pathname === '/api/tasks') {
      this.json(res, 200, this.orchestrator.listTasks());

    } else if (pathname === '/api/meetings') {
      this.json(res, 200, this.orchestrator.listMeetings());

    } else if (pathname === '/api/tools') {
      this.json(res, 200, this.orchestrator.getToolInfo());

    } else if (pathname === '/api/events') {
      const limit  = parseInt(url.searchParams.get('limit') ?? '100', 10);
      const since  = url.searchParams.get('since') ?? undefined;
      const events = await this.orchestrator.readEvents(since);
      this.json(res, 200, events.slice(-limit));

    } else if (pathname === '/api/kanban') {
      if (!this.kanbanPath) { this.json(res, 404, { error: 'Kanban not configured' }); return; }
      const includeBacklog = url.searchParams.get('includeBacklog') === 'true';
      const board = await this.readKanban();
      this.json(res, 200, buildBoardSummary(board, includeBacklog));

    } else if (pathname === '/api/kanban/tickets' && req.method === 'POST') {
      if (!this.kanbanPath) { this.json(res, 404, { error: 'Kanban not configured' }); return; }
      const body   = await this.readBody(req);
      const fields = JSON.parse(body) as {
        title: string; description?: string; priority?: string;
        column?: string; assignee?: string; tags?: string[]; blockedBy?: string[];
      };
      if (!fields.title?.trim()) { this.json(res, 400, { error: 'Title is required' }); return; }
      const board  = await this.readKanban();
      const id     = `TKT-${String(board.nextSeq).padStart(3, '0')}`;
      board.nextSeq++;
      const now    = new Date().toISOString();
      board.tickets[id] = {
        id,
        title:       fields.title.trim(),
        description: fields.description ?? '',
        priority:    (fields.priority ?? 'medium') as never,
        column:      (fields.column ?? 'backlog') as never,
        creator:     'human',
        assignee:    fields.assignee || undefined,
        tags:        fields.tags ?? [],
        blockedBy:   fields.blockedBy?.length ? fields.blockedBy : undefined,
        comments:    [],
        createdAt:   now,
        updatedAt:   now,
      };
      await this.writeKanban(board);
      this.json(res, 201, board.tickets[id]);
      if (board.tickets[id].column === 'in_progress' && board.tickets[id].assignee) {
        this.dispatchTicket(board.tickets[id]).catch(() => {});
      }

    } else if (pathname === '/api/kanban/tickets') {
      if (!this.kanbanPath) { this.json(res, 404, { error: 'Kanban not configured' }); return; }
      const board    = await this.readKanban();
      const column   = url.searchParams.get('column') ?? undefined;
      const assignee = url.searchParams.get('assignee') ?? undefined;
      let tickets    = Object.values(board.tickets);
      if (column)   tickets = tickets.filter((t) => t.column === column);
      if (assignee) tickets = tickets.filter((t) => t.assignee === assignee);
      this.json(res, 200, tickets);

    } else if (pathname.match(/^\/api\/kanban\/tickets\/[^/]+\/comments$/) && req.method === 'POST') {
      if (!this.kanbanPath) { this.json(res, 404, { error: 'Kanban not configured' }); return; }
      const id     = pathname.replace('/api/kanban/tickets/', '').replace('/comments', '');
      const body   = await this.readBody(req);
      const { author, text } = JSON.parse(body) as { author: string; text: string };
      if (!text?.trim()) { this.json(res, 400, { error: 'Text is required' }); return; }
      const board  = await this.readKanban();
      const ticket = board.tickets[id];
      if (!ticket) { this.json(res, 404, { error: `Ticket "${id}" not found` }); return; }
      const comment = { id: `c${Date.now()}`, author: author?.trim() || 'human', text: text.trim(), ts: new Date().toISOString() };
      ticket.comments.push(comment);
      ticket.updatedAt = comment.ts;
      await this.writeKanban(board);
      this.json(res, 201, comment);

    } else if (pathname.startsWith('/api/kanban/tickets/') && req.method === 'PATCH') {
      if (!this.kanbanPath) { this.json(res, 404, { error: 'Kanban not configured' }); return; }
      const id     = pathname.replace('/api/kanban/tickets/', '');
      const body   = await this.readBody(req);
      const fields = JSON.parse(body) as Partial<{
        title: string; description: string; priority: string;
        column: string; assignee: string | null; tags: string[]; blockedBy: string[];
      }>;
      const board  = await this.readKanban();
      const ticket = board.tickets[id];
      if (!ticket) { this.json(res, 404, { error: `Ticket "${id}" not found` }); return; }
      const prevColumn   = ticket.column;
      const prevAssignee = ticket.assignee;
      if (fields.title       !== undefined) ticket.title       = fields.title;
      if (fields.description !== undefined) ticket.description = fields.description;
      if (fields.priority    !== undefined) ticket.priority    = fields.priority as never;
      if (fields.column      !== undefined) ticket.column      = fields.column   as never;
      if (fields.assignee    !== undefined) ticket.assignee    = fields.assignee ?? undefined;
      if (fields.tags        !== undefined) ticket.tags        = fields.tags;
      if (fields.blockedBy   !== undefined) ticket.blockedBy   = fields.blockedBy;
      ticket.updatedAt = new Date().toISOString();
      await this.writeKanban(board);
      this.json(res, 200, ticket);

      // Fan-out: if ticket just completed, unblock dependents
      const columnChanged   = fields.column   !== undefined && prevColumn   !== ticket.column;
      const assigneeChanged = fields.assignee !== undefined && prevAssignee !== ticket.assignee;
      if (columnChanged && ticket.column === 'completed') {
        this.unblockDependents(id).catch(() => {});
      }
      // Dispatch to agent if ticket is now in_progress and either column or assignee changed
      if (ticket.column === 'in_progress' && ticket.assignee && (columnChanged || assigneeChanged)) {
        this.dispatchTicket(ticket).catch(() => {});
      }

    } else if (pathname.startsWith('/api/kanban/tickets/')) {
      if (!this.kanbanPath) { this.json(res, 404, { error: 'Kanban not configured' }); return; }
      const id     = pathname.replace('/api/kanban/tickets/', '');
      const board  = await this.readKanban();
      const ticket = board.tickets[id];
      if (!ticket) { this.json(res, 404, { error: `Ticket "${id}" not found` }); return; }
      this.json(res, 200, ticket);

    } else if (pathname === '/api/mcp/catalogue' && req.method === 'GET') {
      const catalogue = MCP_CATALOGUE.map(entry => ({
        ...entry,
        // Use live connection state as truth — covers servers connected outside the catalogue
        enabled: this.orchestrator.hasMCPServer(entry.id),
        envStatus: (entry.envVars ?? []).map(v => ({ name: v, present: !!process.env[v] })),
      }));
      this.json(res, 200, catalogue);

    } else if (pathname === '/api/mcp/enable' && req.method === 'POST') {
      const body = await this.readBody(req);
      const { id } = JSON.parse(body) as { id: string };
      const entry = MCP_CATALOGUE.find(e => e.id === id);
      if (!entry) { this.json(res, 404, { error: `Unknown MCP server "${id}"` }); return; }
      if (this.orchestrator.hasMCPServer(id)) {
        this.enabledMCPIds.add(id);
        this.json(res, 200, { ok: true });
        return;
      }
      try {
        const config = this.resolveMCPConfig(id, entry);
        await this.orchestrator.addMCPServer({ name: id, config });
        this.enabledMCPIds.add(id);
        await this.saveMCPEnabled();
        this.sseBroadcast({ type: 'tools_update', tools: this.orchestrator.getToolInfo() });
        this.json(res, 200, { ok: true });
      } catch (err) {
        this.json(res, 500, { error: (err as Error).message });
      }

    } else if (pathname === '/api/mcp/disable' && req.method === 'POST') {
      const body = await this.readBody(req);
      const { id } = JSON.parse(body) as { id: string };
      try {
        await this.orchestrator.removeMCPServer(id);
        this.enabledMCPIds.delete(id);
        await this.saveMCPEnabled();
        this.sseBroadcast({ type: 'tools_update', tools: this.orchestrator.getToolInfo() });
        this.json(res, 200, { ok: true });
      } catch (err) {
        this.json(res, 500, { error: (err as Error).message });
      }

    } else if (pathname === '/api/project' && req.method === 'GET') {
      this.json(res, 200, {
        id:   this.projectId,
        dir:  this.projectDir,
        root: this.projectsRoot,
      });

    } else if (pathname === '/api/project/switch' && req.method === 'POST') {
      if (!this.projectLoader) {
        this.json(res, 503, { error: 'Project switching not configured' }); return;
      }
      const body = await this.readBody(req);
      const { id } = JSON.parse(body) as { id: string };
      if (!id?.trim()) { this.json(res, 400, { error: 'id is required' }); return; }
      try {
        await this.switchProject(id.trim());
        const agents  = this.buildAgentStatuses();
        const tickets = await this.readTickets().catch(() => []);
        const meta    = await this.readProjectMeta();
        const project = { id: this.projectId, dir: this.projectDir, goal: meta['goal'] ?? '', humanName: meta['humanName'] ?? 'Human' };
        this.json(res, 200, { ok: true, id: this.projectId, agents, tickets, project });
      } catch (err) {
        this.json(res, 500, { error: (err as Error).message });
      }

    } else if (pathname === '/api/project/goal' && req.method === 'GET') {
      const goal = await this.getProjectGoal();
      this.json(res, 200, { goal });

    } else if (pathname === '/api/project/goal' && req.method === 'PUT') {
      const body = await this.readBody(req);
      const { goal } = JSON.parse(body) as { goal: string };
      const trimmed = (goal ?? '').trim();
      await this.setProjectGoal(trimmed);
      this.orchestrator.setProjectGoal(trimmed || null);
      this.json(res, 200, { ok: true });

    } else if (pathname === '/api/project/human-name' && req.method === 'GET') {
      const humanName = await this.getProjectMeta('humanName') ?? 'Human';
      this.json(res, 200, { humanName });

    } else if (pathname === '/api/project/human-name' && req.method === 'PUT') {
      const body = await this.readBody(req);
      const { humanName } = JSON.parse(body) as { humanName: string };
      const name = (humanName ?? '').trim() || 'Human';
      await this.setProjectMeta('humanName', name);
      this.orchestrator.setHumanName(name);
      this.json(res, 200, { ok: true });

    } else if (pathname === '/api/projects' && req.method === 'GET') {
      // List all project IDs found in the projects root
      if (!this.projectsRoot) { this.json(res, 200, []); return; }
      try {
        const { readdir: rd } = await import('fs/promises');
        const { statSync } = await import('fs');
        const entries = await rd(this.projectsRoot);
        const projects = entries.filter(name => {
          try { return statSync(path.join(this.projectsRoot!, name)).isDirectory(); } catch { return false; }
        }).map(name => ({
          id:     name,
          dir:    path.join(this.projectsRoot!, name),
          active: name === this.projectId,
        }));
        this.json(res, 200, projects);
      } catch {
        this.json(res, 200, []);
      }

    } else if (pathname === '/api/providers' && req.method === 'GET') {
      const providers = await Promise.all(KNOWN_PROVIDERS.map(async p => {
        const baseUrl = p.baseUrlEnvKey ? (process.env[p.baseUrlEnvKey] || p.defaultBaseUrl || '') : undefined;
        let available: boolean;
        if (p.envKey) {
          available = !!process.env[p.envKey];
        } else if (baseUrl) {
          available = await probeLocalLLM(baseUrl);
        } else {
          available = false;
        }
        // Return cached live models if available, otherwise static list
        const cached = modelCache.get(p.id);
        const models = (cached && (Date.now() - cached.ts) < modelCacheTtl(p.id)) ? cached.models : p.models;
        return {
          ...p,
          models,
          available,
          defaultModel: process.env[p.modelEnvKey] ?? models[0] ?? '',
          baseUrl,
        };
      }));
      this.json(res, 200, providers);

    } else if (pathname === '/api/providers/models' && req.method === 'GET') {
      // Fetch live models for all providers (respects per-provider TTL cache).
      // Pass ?refresh=true to force re-fetch and ignore cached values.
      if (url.searchParams.get('refresh') === 'true') {
        for (const p of KNOWN_PROVIDERS) modelCache.delete(p.id);
      }
      const results = await Promise.all(
        KNOWN_PROVIDERS.map(async p => ({ id: p.id, models: await getCachedModels(p) })),
      );
      this.json(res, 200, results);

    } else if (pathname === '/api/pricing' && req.method === 'GET') {
      this.json(res, 200, {
        pricing:       getPricingTable(),
        freeProviders: [...FREE_PROVIDERS],
      });

    } else if (pathname === '/api/env' && req.method === 'GET') {
      const entries = await readEnvFile(this.envPath);
      this.json(res, 200, entries);

    } else if (pathname === '/api/env' && req.method === 'POST') {
      const body = await this.readBody(req);
      const updates = JSON.parse(body) as Record<string, string>;
      await writeEnvFile(this.envPath, updates);
      // Also update process.env so new provider instances pick up the changes immediately
      for (const [key, value] of Object.entries(updates)) {
        process.env[key] = value;
      }
      this.json(res, 200, { ok: true });

    } else if (pathname.match(/^\/api\/agents\/[^/]+\/prompt-preview$/) && req.method === 'GET') {
      const agentName = decodeURIComponent(pathname.slice('/api/agents/'.length, -'/prompt-preview'.length));
      const hatParam  = url.searchParams.get('hat') as HatType | null;
      const specParam = url.searchParams.get('specialisation') ?? undefined;
      try {
        const resolved = this.resolveAgentName(agentName);
        const agent    = this.orchestrator.getAgent(resolved);
        if (!agent) { this.json(res, 404, { error: `Agent "${agentName}" not found` }); return; }
        const hatType = hatParam ?? agent.hatType;
        const hat     = getHatDefinition(hatType);
        const prompt  = generateSystemPrompt({
          name:               agent.config.identity.name,
          visualDescription:  agent.config.identity.visualDescription,
          backstory:          agent.config.identity.backstory,
          hatLabel:           hat.label,
          thinkingStyle:      hat.thinkingStyle,
          communicationTone:  hat.communicationTone,
          directives:         hat.directives,
          avoidances:         hat.avoidances,
          teamRole:           hat.teamRole,
          teamContext:        agent.config.teamContext,
          projectDir:         agent.config.projectDir,
          projectGoal:        agent.config.projectGoal,
          specialisation:     specParam !== undefined ? specParam : agent.config.identity.specialisation,
        });
        this.json(res, 200, { prompt: prompt.text });
      } catch (err) {
        this.json(res, 400, { error: (err as Error).message });
      }

    } else if (pathname.match(/^\/api\/agents\/[^/]+\/config$/) && req.method === 'PATCH') {
      const agentName = decodeURIComponent(pathname.slice('/api/agents/'.length, -'/config'.length));
      const body = await this.readBody(req);
      const { provider: providerName, model } = JSON.parse(body) as { provider: string; model: string };
      if (!model?.trim()) { this.json(res, 400, { error: 'model is required' }); return; }
      const provider = makeProvider(providerName);
      if (!provider) { this.json(res, 400, { error: `Unknown provider "${providerName}"` }); return; }
      try {
        this.orchestrator.updateAgentConfig(this.resolveAgentName(agentName), provider, model.trim());
        this.sseBroadcast({ type: 'agent_update', agents: this.buildAgentStatuses() });
        this.saveCurrentState().catch(() => {});
        this.json(res, 200, { ok: true });
      } catch (err) {
        this.json(res, 404, { error: (err as Error).message });
      }

    } else if (pathname.match(/^\/api\/agents\/[^/]+\/name$/) && req.method === 'PATCH') {
      const oldName = decodeURIComponent(pathname.slice('/api/agents/'.length, -'/name'.length));
      const body = await this.readBody(req);
      const { name: newName } = JSON.parse(body) as { name: string };
      if (!newName?.trim()) { this.json(res, 400, { error: 'name is required' }); return; }
      try {
        const resolved = this.resolveAgentName(oldName);
        this.orchestrator.renameAgent(resolved, newName.trim());
        // Update any in-progress ticket map
        const ticket = this.agentTicketMap.get(resolved.toLowerCase());
        if (ticket) {
          this.agentTicketMap.delete(resolved.toLowerCase());
          this.agentTicketMap.set(newName.trim().toLowerCase(), ticket);
        }
        const activity = this.agentActivity.get(resolved);
        if (activity) {
          this.agentActivity.delete(resolved);
          this.agentActivity.set(newName.trim(), activity);
        }
        this.sseBroadcast({ type: 'agent_update', agents: this.buildAgentStatuses() });
        this.saveCurrentState().catch(() => {});
        this.json(res, 200, { ok: true, name: newName.trim() });
      } catch (err) {
        this.json(res, 400, { error: (err as Error).message });
      }

    } else if (pathname.match(/^\/api\/agents\/[^/]+\/specialisation$/) && req.method === 'PATCH') {
      const agentName = decodeURIComponent(pathname.slice('/api/agents/'.length, -'/specialisation'.length));
      const body = await this.readBody(req);
      const { specialisation } = JSON.parse(body) as { specialisation?: string };
      try {
        const resolved = this.resolveAgentName(agentName);
        this.orchestrator.updateAgentSpecialisation(resolved, specialisation?.trim() || undefined);
        this.sseBroadcast({ type: 'agent_update', agents: this.buildAgentStatuses() });
        this.saveCurrentState().catch(() => {});
        this.json(res, 200, { ok: true });
      } catch (err) {
        this.json(res, 400, { error: (err as Error).message });
      }

    } else if (pathname.match(/^\/api\/agents\/[^/]+\/voice$/) && req.method === 'PATCH') {
      const agentName = decodeURIComponent(pathname.slice('/api/agents/'.length, -'/voice'.length));
      const body = await this.readBody(req);
      const { voice, speakerName } = JSON.parse(body) as { voice?: string; speakerName?: string };
      try {
        const resolved = this.resolveAgentName(agentName);
        this.orchestrator.updateAgentVoice(resolved, voice?.trim() || undefined, speakerName?.trim() || undefined);
        this.sseBroadcast({ type: 'agent_update', agents: this.buildAgentStatuses() });
        this.saveCurrentState().catch(() => {});
        this.json(res, 200, { ok: true });
      } catch (err) {
        this.json(res, 400, { error: (err as Error).message });
      }

    } else if (pathname.match(/^\/api\/agents\/[^/]+\/avatar$/) && req.method === 'PATCH') {
      const agentName = decodeURIComponent(pathname.slice('/api/agents/'.length, -'/avatar'.length));
      const body = await this.readBody(req);
      const { avatar } = JSON.parse(body) as { avatar?: string };
      try {
        const resolved = this.resolveAgentName(agentName);
        this.orchestrator.updateAgentAvatar(resolved, avatar?.trim() || undefined);
        this.sseBroadcast({ type: 'agent_update', agents: this.buildAgentStatuses() });
        this.saveCurrentState().catch(() => {});
        this.json(res, 200, { ok: true });
      } catch (err) {
        this.json(res, 400, { error: (err as Error).message });
      }

    } else if (pathname.match(/^\/api\/agents\/[^/]+\/background$/) && req.method === 'PATCH') {
      const agentName = decodeURIComponent(pathname.slice('/api/agents/'.length, -'/background'.length));
      const body = await this.readBody(req);
      const { background } = JSON.parse(body) as { background?: string };
      try {
        const resolved = this.resolveAgentName(agentName);
        this.orchestrator.updateAgentBackground(resolved, background?.trim() || undefined);
        this.sseBroadcast({ type: 'agent_update', agents: this.buildAgentStatuses() });
        this.saveCurrentState().catch(() => {});
        this.json(res, 200, { ok: true });
      } catch (err) {
        this.json(res, 400, { error: (err as Error).message });
      }

    } else if (pathname === '/api/images/backgrounds' && req.method === 'GET') {
      try {
        await mkdir(BACKGROUNDS_DIR, { recursive: true });
        const files = await readdir(BACKGROUNDS_DIR);
        const images = files.filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f)).sort();
        this.json(res, 200, { backgrounds: images });
      } catch {
        this.json(res, 200, { backgrounds: [] });
      }

    } else if (pathname === '/api/images/generate' && req.method === 'POST') {
      const apiKey = process.env['OPENAI_API_KEY'];
      if (!apiKey) { this.json(res, 400, { error: 'OPENAI_API_KEY not configured' }); return; }
      const body = await this.readBody(req);
      const { prompt } = JSON.parse(body) as { prompt?: string };
      if (!prompt?.trim()) { this.json(res, 400, { error: 'prompt is required' }); return; }
      try {
        // Call DALL-E 3 via the OpenAI REST API using built-in fetch
        const response = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: 'dall-e-3',
            prompt: prompt.trim(),
            n: 1,
            size: '1792x1024',
            response_format: 'b64_json',
          }),
        });
        if (!response.ok) {
          const err = await response.text();
          this.json(res, 502, { error: `OpenAI error: ${err}` }); return;
        }
        const data = await response.json() as { data: Array<{ b64_json: string }> };
        const b64 = data.data[0]?.b64_json;
        if (!b64) { this.json(res, 502, { error: 'No image data returned' }); return; }
        await mkdir(BACKGROUNDS_DIR, { recursive: true });
        const filename = `bg-${Date.now()}.png`;
        await writeFile(path.join(BACKGROUNDS_DIR, filename), Buffer.from(b64, 'base64'));
        this.json(res, 200, { filename });
      } catch (err) {
        this.json(res, 500, { error: (err as Error).message });
      }

    } else if (pathname.match(/^\/api\/agents\/[^/]+\/hat$/) && req.method === 'PATCH') {
      const agentName = decodeURIComponent(pathname.slice('/api/agents/'.length, -'/hat'.length));
      const body = await this.readBody(req);
      const { hatType } = JSON.parse(body) as { hatType: string };
      const validHats = ['white', 'red', 'black', 'yellow', 'green', 'blue'];
      if (!validHats.includes(hatType)) { this.json(res, 400, { error: `Invalid hat type "${hatType}"` }); return; }
      try {
        this.orchestrator.changeAgentHat(this.resolveAgentName(agentName), hatType as HatType);
        this.sseBroadcast({ type: 'agent_update', agents: this.buildAgentStatuses() });
        this.saveCurrentState().catch(() => {});
        this.json(res, 200, { ok: true });
      } catch (err) {
        this.json(res, 404, { error: (err as Error).message });
      }

    } else if (pathname === '/api/agents' && req.method === 'POST') {
      const body = await this.readBody(req);
      const { name, hatType, visualDescription, specialisation, backstory, provider: providerName, model } =
        JSON.parse(body) as { name: string; hatType: string; visualDescription?: string; specialisation?: string; backstory?: string; provider?: string; model?: string };
      if (!name?.trim()) { this.json(res, 400, { error: 'name is required' }); return; }
      const validHats = ['white', 'red', 'black', 'yellow', 'green', 'blue'];
      if (!validHats.includes(hatType)) { this.json(res, 400, { error: `Invalid hat type "${hatType}"` }); return; }
      const exists = this.orchestrator.listAgents().some(a => a.name.toLowerCase() === name.trim().toLowerCase());
      if (exists) { this.json(res, 409, { error: `Agent "${name}" already exists` }); return; }
      const provider = makeProvider(providerName ?? 'anthropic') ?? new AnthropicProvider();
      const resolvedModel = model?.trim() || (
        providerName === 'openai'   ? (process.env['OPENAI_MODEL']      ?? 'gpt-4.1-mini') :
        providerName === 'gemini'   ? (process.env['GEMINI_MODEL']      ?? 'gemini-2.5-flash') :
        providerName === 'ollama'   ? (process.env['OLLAMA_MODEL']      ?? 'llama3.2') :
        providerName === 'lmstudio' ? (process.env['LM_STUDIO_MODEL']   ?? '') :
                                      (process.env['ANTHROPIC_MODEL']   ?? 'claude-haiku-4-5-20251001')
      );
      this.orchestrator.registerAgent({
        identity: {
          name: name.trim(),
          visualDescription: visualDescription?.trim() || 'a focused, capable team member',
          specialisation: specialisation?.trim() || undefined,
          backstory: backstory?.trim() || undefined,
        },
        hatType: hatType as HatType,
        provider,
        model: resolvedModel,
      });
      this.sseBroadcast({ type: 'agent_update', agents: this.buildAgentStatuses() });
      this.saveCurrentState().catch(() => {});
      this.json(res, 201, { ok: true });

    } else if (pathname.match(/^\/api\/agents\/[^/]+$/) && req.method === 'DELETE') {
      const agentName = decodeURIComponent(pathname.slice('/api/agents/'.length));
      try {
        const resolved = this.resolveAgentName(agentName);
        this.orchestrator.removeAgent(resolved);
        // Unassign in-progress kanban tickets for this agent → return to backlog
        if (this.kanbanPath) {
          try {
            const board = await this.readKanban();
            let changed = false;
            for (const ticket of Object.values(board.tickets)) {
              if (ticket.assignee?.toLowerCase() === resolved.toLowerCase() &&
                  (ticket.column === 'in_progress' || ticket.column === 'ready')) {
                ticket.column = 'backlog';
                ticket.assignee = undefined;
                ticket.updatedAt = new Date().toISOString();
                changed = true;
              }
            }
            if (changed) await this.writeKanban(board);
          } catch { /* non-fatal */ }
        }
        this.agentActivity.delete(resolved);
        this.agentFeeds.delete(resolved.toLowerCase());
        const timerKey = resolved;
        const timer = this.talkingTimers.get(timerKey);
        if (timer) { clearTimeout(timer); this.talkingTimers.delete(timerKey); }
        this.agentTicketMap.delete(resolved.toLowerCase());
        this.sseBroadcast({ type: 'agent_update', agents: this.buildAgentStatuses() });
        this.saveCurrentState().catch(() => {});
        this.json(res, 200, { ok: true });
      } catch (err) {
        this.json(res, 404, { error: (err as Error).message });
      }

    } else if (pathname === '/api/debug/logging') {
      if (req.method === 'POST') {
        const body = await this.readBody(req);
        const { enabled } = JSON.parse(body) as { enabled: boolean };
        debugState.logPrompts = enabled;
        log.info(`[Debug] Prompt logging ${enabled ? 'ON' : 'OFF'}`);
      }
      this.json(res, 200, { logPrompts: debugState.logPrompts });

    } else if (pathname === '/api/cli' && req.method === 'POST') {
      const body   = await this.readBody(req);
      const { line } = JSON.parse(body) as { line: string };
      const output = await this.handleCLICommand(line?.trim() ?? '');
      this.json(res, 200, { output });

    } else if (pathname === '/api/meetings/start' && req.method === 'POST') {
      const body   = await this.readBody(req);
      const fields = JSON.parse(body) as { topic?: string; agenda?: string; facilitator?: string; participants?: string[] };
      if (!fields.topic?.trim())     { this.json(res, 400, { error: 'topic is required' }); return; }
      if (!fields.facilitator?.trim()) { this.json(res, 400, { error: 'facilitator is required' }); return; }
      const facilitator  = this.resolveAgentName(fields.facilitator);
      // Strip the facilitator from participants — startMeeting handles them separately
      const participants = (fields.participants ?? []).filter((p: string) => p !== facilitator);
      const topic        = fields.topic.trim();
      const agenda       = fields.agenda?.trim();
      const now          = new Date().toISOString();
      try {
        // Launch meeting immediately (fire-and-forget — meeting runs async)
        void this.orchestrator.launchImpromptuMeeting(facilitator, participants, topic, agenda);

        // Record directly as 'launched' — never picked up by the scheduler
        this.orchestrator.recordImpromptuInCalendar({ topic, agenda, facilitator, participants, startedAt: now })
          .then(() => {
            this.sseBroadcast({ type: 'scheduled_meetings_update', meetings: this.orchestrator.listScheduledMeetings() });
          }).catch(() => {});

        this.json(res, 201, { ok: true });
      } catch (err) {
        this.json(res, 400, { error: (err as Error).message });
      }

    } else if (pathname === '/api/scheduled-meetings' && req.method === 'GET') {
      this.json(res, 200, this.orchestrator.listScheduledMeetings());

    } else if (pathname === '/api/scheduled-meetings' && req.method === 'POST') {
      const body = await this.readBody(req);
      const fields = JSON.parse(body) as {
        type: string; topic: string; agenda?: string;
        facilitator: string; participants: string[]; scheduledFor: string;
      };
      if (!fields.topic?.trim()) { this.json(res, 400, { error: 'topic is required' }); return; }
      if (!fields.facilitator?.trim()) { this.json(res, 400, { error: 'facilitator is required' }); return; }
      if (!fields.scheduledFor) { this.json(res, 400, { error: 'scheduledFor is required' }); return; }
      const validTypes = ['standup', 'sprint_planning', 'retro', 'review', 'ad_hoc'];
      if (!validTypes.includes(fields.type)) { this.json(res, 400, { error: `Invalid type "${fields.type}"` }); return; }
      const when = new Date(fields.scheduledFor);
      if (isNaN(when.getTime())) { this.json(res, 400, { error: 'Invalid scheduledFor date' }); return; }
      try {
        const meeting = await this.orchestrator.createScheduledMeeting({
          type: fields.type as MeetingType,
          topic: fields.topic.trim(),
          agenda: fields.agenda?.trim(),
          facilitator: this.resolveAgentName(fields.facilitator),
          participants: fields.participants ?? [],
          scheduledFor: when.toISOString(),
          createdBy: 'human',
        });
        this.sseBroadcast({ type: 'scheduled_meetings_update', meetings: this.orchestrator.listScheduledMeetings() });
        this.json(res, 201, meeting);
      } catch (err) {
        this.json(res, 400, { error: (err as Error).message });
      }

    } else if (pathname.match(/^\/api\/scheduled-meetings\/[^/]+\/cancel$/) && req.method === 'POST') {
      const id = pathname.replace('/api/scheduled-meetings/', '').replace('/cancel', '');
      try {
        await this.orchestrator.cancelScheduledMeeting(id);
        this.sseBroadcast({ type: 'scheduled_meetings_update', meetings: this.orchestrator.listScheduledMeetings() });
        this.json(res, 200, { ok: true });
      } catch (err) {
        this.json(res, 400, { error: (err as Error).message });
      }

    } else if (pathname.match(/^\/api\/scheduled-meetings\/[^/]+$/) && req.method === 'DELETE') {
      const id = pathname.replace('/api/scheduled-meetings/', '');
      const deleted = await this.orchestrator.deleteScheduledMeeting(id);
      if (deleted) {
        this.sseBroadcast({ type: 'scheduled_meetings_update', meetings: this.orchestrator.listScheduledMeetings() });
        this.json(res, 200, { ok: true });
      } else {
        this.json(res, 404, { error: 'Meeting not found' });
      }

    } else if (pathname.match(/^\/api\/scheduled-meetings\/[^/]+\/launch$/) && req.method === 'POST') {
      const id = pathname.replace('/api/scheduled-meetings/', '').replace('/launch', '');
      try {
        await this.orchestrator.launchScheduledMeeting(id);
        this.sseBroadcast({ type: 'scheduled_meetings_update', meetings: this.orchestrator.listScheduledMeetings() });
        this.json(res, 200, { ok: true });
      } catch (err) {
        this.json(res, 400, { error: (err as Error).message });
      }

    } else if (pathname === '/api/specialisations') {
      this.json(res, 200, { specialisations: Object.keys(SPECIALISATION_DIRECTIVES) });

    } else if (pathname === '/api/avatars') {
      try {
        const raw = await readFile(path.join(AVATARS_DIR, 'avatars.json'), 'utf-8');
        this.json(res, 200, JSON.parse(raw));
      } catch {
        this.json(res, 404, { avatars: [] });
      }

    } else if (pathname === '/api/voices') {
      this.json(res, 200, this.voiceManager.getVoices());

    } else if (pathname === '/api/speech/preview' && req.method === 'POST') {
      const voices = this.voiceManager.getVoices();
      if (voices.length === 0) { this.json(res, 404, { error: 'No voices configured' }); return; }
      const body = await this.readBody(req);
      const { voice: voiceName, speakerName } = JSON.parse(body) as { voice?: string; speakerName?: string };
      const voice = this.voiceManager.resolveVoice(voiceName);
      if (!voice) { this.json(res, 404, { error: 'Voice not found' }); return; }
      try {
        let speakerId: number | null = voice.speakerId;
        if (speakerName && voice.speakers.length > 0) {
          const found = voice.speakers.find(s => s.name === speakerName);
          if (found) speakerId = found.id;
        }
        const payload: Record<string, unknown> = { text: 'Hello  I am ready to help with your project.' };
        if (speakerId !== null) payload['speaker_id'] = speakerId;
        const piperRes = await fetch(`${voice.url}/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(15_000),
        });
        if (!piperRes.ok) { this.json(res, 502, { error: `TTS error: ${piperRes.status}` }); return; }
        const wavBuffer = Buffer.from(await piperRes.arrayBuffer());
        res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': String(wavBuffer.length) });
        res.end(wavBuffer);
      } catch (err) {
        this.json(res, 500, { error: (err as Error).message });
      }

    } else if (pathname === '/api/speech/transcribe' && req.method === 'POST') {
      // Whisper STT: accepts raw audio body (webm/ogg/mp4/wav), returns { text }
      const apiKey = process.env['OPENAI_API_KEY'];
      if (!apiKey) { this.json(res, 400, { error: 'OPENAI_API_KEY not set — Whisper unavailable' }); return; }
      const audioBuffer = await this.readBodyBuffer(req);
      if (!audioBuffer.length) { this.json(res, 400, { error: 'No audio data received' }); return; }
      try {
        // Build multipart form — Node's fetch supports FormData with Blob
        const contentType = req.headers['content-type'] ?? 'audio/webm';
        const ext = contentType.includes('mp4') ? 'mp4'
                  : contentType.includes('ogg')  ? 'ogg'
                  : contentType.includes('wav')  ? 'wav'
                  : 'webm';
        const blob = new Blob([audioBuffer], { type: contentType });
        const form = new FormData();
        form.append('file', blob, `recording.${ext}`);
        form.append('model', 'whisper-1');
        const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}` },
          body: form,
          signal: AbortSignal.timeout(30_000),
        });
        if (!whisperRes.ok) {
          const err = await whisperRes.text();
          this.json(res, 502, { error: `Whisper API error: ${whisperRes.status} — ${err}` }); return;
        }
        const data = await whisperRes.json() as { text: string };
        this.json(res, 200, { text: data.text?.trim() ?? '' });
      } catch (err) {
        this.json(res, 500, { error: (err as Error).message });
      }

    } else if (pathname === '/api/speech/synthesise' && req.method === 'POST') {
      // Full TTS pipeline: returns [{audioBase64, visemes, duration, sentence}]
      const voices = this.voiceManager.getVoices();
      if (voices.length === 0) { this.json(res, 404, { error: 'No voices configured' }); return; }
      const body = await this.readBody(req);
      const { text, voice: voiceName, speakerName } = JSON.parse(body) as { text?: string; voice?: string; speakerName?: string };
      if (!text?.trim()) { this.json(res, 400, { error: 'text required' }); return; }
      const voice = this.voiceManager.resolveVoice(voiceName);
      if (!voice) { this.json(res, 404, { error: 'Voice not found' }); return; }
      try {
        let speakerId: number | null = voice.speakerId;
        if (speakerName && voice.speakers.length > 0) {
          const found = voice.speakers.find(s => s.name === speakerName);
          if (found) speakerId = found.id;
        }
        const chunks: unknown[] = [];
        await processSpeech(text, '__meeting__', voice.url, speakerId, (chunk) => { chunks.push(chunk); });
        this.json(res, 200, { chunks });
      } catch (err) {
        this.json(res, 500, { error: (err as Error).message });
      }

    } else if (pathname.startsWith('/api/meetings/') && pathname.endsWith('/cancel') && req.method === 'POST') {
      const meetingId = pathname.split('/')[3];
      // Unblock any pending human turn so the room can exit
      const resolver = this.pendingHumanTurns.get(meetingId);
      if (resolver) { this.pendingHumanTurns.delete(meetingId); resolver(null); }
      const cancelled = this.orchestrator.cancelActiveMeeting(meetingId);
      this.json(res, cancelled ? 200 : 404, { ok: cancelled });

    } else if (pathname.startsWith('/api/meetings/') && pathname.endsWith('/human-turn') && req.method === 'POST') {
      const meetingId = pathname.split('/')[3];
      const body = await this.readBody(req);
      const { content } = JSON.parse(body) as { content?: string };
      const resolver = this.pendingHumanTurns.get(meetingId);
      if (resolver) {
        this.pendingHumanTurns.delete(meetingId);
        resolver(content?.trim() || null);
        this.json(res, 200, { ok: true });
      } else {
        this.json(res, 404, { error: 'No pending human turn' });
      }

    } else if (pathname.startsWith('/api/meetings/') && pathname.endsWith('/human-interject') && req.method === 'POST') {
      const meetingId = pathname.split('/')[3];
      const body = await this.readBody(req);
      const { content } = JSON.parse(body) as { content?: string };
      if (!content?.trim()) { this.json(res, 400, { error: 'content is required' }); return; }
      this.orchestrator.humanMeetingInterjection(meetingId, content.trim());
      this.json(res, 200, { ok: true });

    } else if (pathname === '/api/project/files' && req.method === 'GET') {
      if (!this.projectDir) { this.json(res, 404, { error: 'No project loaded' }); return; }
      try {
        const sources = await listFilesRecursive(path.join(this.projectDir, 'sources'), this.projectDir, 'sources');
        const outputs = await listFilesRecursive(path.join(this.projectDir, 'outputs'), this.projectDir, 'outputs');
        this.json(res, 200, { sources, outputs });
      } catch {
        this.json(res, 200, { sources: [], outputs: [] });
      }

    } else if (pathname === '/api/project/upload' && req.method === 'POST') {
      if (!this.projectDir) { this.json(res, 503, { error: 'No project loaded' }); return; }
      const rawFilename = req.headers['x-filename'] as string | undefined;
      if (!rawFilename?.trim()) { this.json(res, 400, { error: 'X-Filename header required' }); return; }
      // Sanitise: strip path separators, keep only the basename
      const filename = path.basename(decodeURIComponent(rawFilename)).replace(/[\\/:*?"<>|]/g, '_');
      if (!filename) { this.json(res, 400, { error: 'Invalid filename' }); return; }
      const destPath = path.join(this.projectDir, 'sources', filename);
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        await writeFile(destPath, Buffer.concat(chunks));
        this.json(res, 201, { ok: true, path: `sources/${filename}` });
        // Notify connected clients
        const sources = await listFilesRecursive(path.join(this.projectDir, 'sources'), this.projectDir, 'sources');
        const outputs = await listFilesRecursive(path.join(this.projectDir, 'outputs'), this.projectDir, 'outputs');
        this.sseBroadcast({ type: 'files_update', sources, outputs });
      } catch (err) {
        this.json(res, 500, { error: (err as Error).message });
      }

    } else if (pathname === '/api/project/file' && req.method === 'GET') {
      if (!this.projectDir) { this.json(res, 404, { error: 'No project loaded' }); return; }
      const rel = url.searchParams.get('path') ?? '';
      if (!rel || rel.includes('..')) { this.json(res, 400, { error: 'Invalid path' }); return; }
      const abs = path.join(this.projectDir, rel);
      // Must stay inside projectDir
      if (!abs.startsWith(this.projectDir + path.sep) && abs !== this.projectDir) {
        this.json(res, 403, { error: 'Forbidden' }); return;
      }
      try {
        const data = await readFile(abs);
        const ext = path.extname(abs).toLowerCase().slice(1);
        const mimeMap: Record<string, string> = {
          pdf: 'application/pdf', txt: 'text/plain', md: 'text/plain',
          png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
          webp: 'image/webp', svg: 'image/svg+xml',
          json: 'application/json', csv: 'text/csv',
        };
        const mime = mimeMap[ext] ?? 'application/octet-stream';
        const inline = ['pdf', 'txt', 'md', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext);
        res.writeHead(200, {
          'Content-Type': mime,
          'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${path.basename(abs)}"`,
          'Content-Length': data.length,
        });
        res.end(data);
      } catch {
        this.json(res, 404, { error: 'File not found' });
      }

    } else if (pathname === '/api/telemetry') {
      if (this.telemetry) {
        this.json(res, 200, {
          summary: this.telemetry.getSummary(),
          records: this.telemetry.getAll(),
        });
      } else {
        this.json(res, 200, { summary: null, records: [] });
      }

    } else if (pathname.startsWith('/api/')) {
      this.json(res, 404, { error: 'Not found' });

    // ── Static: node_modules (Three.js, etc.) ────────────────────────────────

    } else if (pathname.startsWith('/nm/')) {
      const rel      = pathname.slice('/nm/'.length);
      const filePath = path.join(NM_DIR, rel);
      if (!filePath.startsWith(NM_DIR)) {
        res.writeHead(403); res.end('Forbidden'); return;
      }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        const ct = MIME[path.extname(filePath)] ?? 'application/javascript';
        res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'public, max-age=86400' });
        res.end(data);
      });

    // ── Static: avatar GLB files ──────────────────────────────────────────────

    } else if (pathname.startsWith('/avatars/')) {
      const rel      = pathname.slice('/avatars/'.length);
      const filePath = path.join(AVATARS_DIR, rel);
      if (!filePath.startsWith(AVATARS_DIR)) {
        res.writeHead(403); res.end('Forbidden'); return;
      }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        const ct = MIME[path.extname(filePath)] ?? 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': ct });
        res.end(data);
      });

    // ── Static: generated background images ──────────────────────────────────

    } else if (pathname.startsWith('/backgrounds/')) {
      const rel      = pathname.slice('/backgrounds/'.length);
      const filePath = path.join(BACKGROUNDS_DIR, rel);
      if (!filePath.startsWith(BACKGROUNDS_DIR)) {
        res.writeHead(403); res.end('Forbidden'); return;
      }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        const ct = MIME[path.extname(filePath)] ?? 'image/png';
        res.writeHead(200, { 'Content-Type': ct });
        res.end(data);
      });

    // ── Static files (browser dashboard UI) ──────────────────────────────────

    } else {
      const rel      = pathname === '/' ? 'index.html' : pathname.slice(1);
      const filePath = path.join(PUBLIC_DIR, rel);

      if (!filePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403); res.end('Forbidden'); return;
      }

      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        const ct = MIME[path.extname(filePath)] ?? 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': ct });
        res.end(data);
      });
    }
  }

  // ── Shared helpers ────────────────────────────────────────────────────────

  private buildTeamSnapshot() {
    return {
      agents:   this.buildAgentStatuses(),
      tasks:    this.orchestrator.listTasks(),
      meetings: this.orchestrator.listMeetings(),
    };
  }

  private async readKanban(): Promise<Board> {
    const raw = await readFile(this.kanbanPath!, 'utf-8');
    return JSON.parse(raw) as Board;
  }

  /** Write the board atomically (temp file + rename) to prevent partial-write corruption. */
  private async writeKanban(board: Board): Promise<void> {
    const tmp = this.kanbanPath! + '.tmp';
    await writeFile(tmp, JSON.stringify(board, null, 2), 'utf-8');
    await rename(tmp, this.kanbanPath!);
  }

  private json(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  /** Resolve a catalogue entry config, injecting project-specific args where needed. */
  private resolveMCPConfig(id: string, entry: import('../mcp/mcp-catalogue.js').MCPCatalogueEntry) {
    const config = resolveConfig(entry.config);
    if (id === 'kanban' && this.kanbanPath && config.transport === 'stdio') {
      return { ...config, args: [...(config.args ?? []), this.kanbanPath] };
    }
    if (id === 'filesystem' && this.projectDir && config.transport === 'stdio') {
      // Give the filesystem server access to the full project dir (includes sources/ and outputs/)
      return { ...config, args: [...(config.args ?? []), this.projectDir] };
    }
    return config;
  }

  private async loadMCPEnabled(): Promise<void> {
    try {
      const raw = await readFile(this.mcpEnabledPath, 'utf-8');
      const data = JSON.parse(raw) as { ids: string[] };
      for (const id of data.ids ?? []) {
        const entry = MCP_CATALOGUE.find(e => e.id === id);
        if (!entry || this.orchestrator.hasMCPServer(id)) continue;
        try {
          const config = this.resolveMCPConfig(id, entry);
          await this.orchestrator.addMCPServer({ name: id, config });
          this.enabledMCPIds.add(id);
        } catch (err) {
          log.warn(`[MCP] Failed to reconnect "${id}":`, (err as Error).message);
        }
      }
    } catch {
      // File doesn't exist yet — that's fine
    }
  }

  private async saveMCPEnabled(): Promise<void> {
    const data = { ids: Array.from(this.enabledMCPIds) };
    await writeFile(this.mcpEnabledPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
  }

  private readBodyBuffer(req: IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  // ── Web CLI command handler ────────────────────────────────────────────────

  private async handleCLICommand(line: string): Promise<string> {
    if (!line) return '';

    // @AgentName message
    if (line.startsWith('@')) {
      const spaceIdx = line.indexOf(' ');
      if (spaceIdx === -1) return 'Usage: @AgentName message';
      const name    = this.resolveAgentName(line.slice(1, spaceIdx));
      const message = line.slice(spaceIdx + 1);
      await this.orchestrator.humanMessage(name, message);
      // Unblock escalation ticket if agent was waiting for human
      const ticketId = this.agentTicketMap.get(name.toLowerCase());
      if (ticketId) this.updateKanbanColumn(ticketId, 'in_progress').catch(() => {});
      return `→ Sent to ${name}`;
    }

    // task AgentName [project-name]: description
    if (line.startsWith('task ')) {
      const rest      = line.slice(5);
      const colonIdx  = rest.indexOf(':');
      if (colonIdx === -1) return 'Usage: task AgentName [project-name]: description';
      const beforeColon  = rest.slice(0, colonIdx).trim();
      const task         = rest.slice(colonIdx + 1).trim();
      const bracketMatch = beforeColon.match(/^(\S+)\s+\[([^\]]+)\]$/);
      const name         = this.resolveAgentName(bracketMatch ? bracketMatch[1] : beforeColon);
      const projectName  = bracketMatch ? bracketMatch[2] : undefined;
      await this.orchestrator.humanAssignTask(name, task, undefined, projectName);
      const stored = this.orchestrator.listTasks().find(t => t.assignedTo === name && t.description === task);
      return `Task assigned to ${name}. Project folder: ${stored?.projectFolder ?? '?'}`;
    }

    // reply AgentName: message
    if (line.startsWith('reply ')) {
      const rest     = line.slice(6);
      const colonIdx = rest.indexOf(':');
      if (colonIdx === -1) return 'Usage: reply AgentName: message';
      const name    = this.resolveAgentName(rest.slice(0, colonIdx).trim());
      const message = rest.slice(colonIdx + 1).trim();
      await this.orchestrator.humanReply(name, message);
      // Unblock the ticket now that the human has responded
      const ticketId = this.agentTicketMap.get(name.toLowerCase());
      if (ticketId) this.updateKanbanColumn(ticketId, 'in_progress').catch(() => {});
      return `→ Sent to ${name}`;
    }

    // resume
    if (line === 'resume') {
      // Re-send to agents that have active (interrupted) tasks
      const active = this.orchestrator.listTasks().filter(t => t.status === 'active');
      for (const task of active) {
        const name = this.resolveAgentName(task.assignedTo);
        await this.orchestrator.humanMessage(name, `You have an active task to continue: ${task.description}`);
      }
      // Also dispatch any in_progress kanban tickets with no active orchestrator task
      await this.dispatchUnstartedTickets();
      return active.length > 0
        ? `Resumed ${active.length} active task(s) and re-dispatched in-progress kanban tickets.`
        : 'Re-dispatched in-progress kanban tickets.';
    }

    if (line === 'status') {
      const agents = this.orchestrator.listAgents();
      if (agents.length === 0) return 'No agents.';
      return agents.map(a => `  ${a.name} (${a.hatType} hat) — ${a.state}`).join('\n');
    }

    if (line === 'tasks') {
      const tasks = this.orchestrator.listTasks() as Task[];
      if (tasks.length === 0) return 'No tasks.';
      return tasks.map(t => {
        const done = t.status === 'complete' ? ` ✓ ${(t.summary ?? '').slice(0, 40)}` : '';
        return `  [${t.status.padEnd(8)}] ${t.assignedTo}: ${t.description.slice(0, 50)}${done}`;
      }).join('\n');
    }

    if (line === 'meetings') {
      const meetings = this.orchestrator.listMeetings() as Meeting[];
      if (meetings.length === 0) return 'No meetings.';
      return meetings.map(m => `  [${m.status}] "${m.topic}" — ${m.turns.length} turns`).join('\n');
    }

    if (line === 'help') {
      return [
        'Commands:',
        '  message                        — broadcast to ALL agents (interrupts current work)',
        '  @AgentName message             — DM a specific agent',
        '  task AgentName: text           — assign a task',
        '  task AgentName [name]: text    — assign with project name',
        '  reply AgentName: text          — reply to escalation',
        '  status                         — show agent states',
        '  tasks                          — list tasks',
        '  meetings                       — list meetings',
        '  resume                         — re-deliver active tasks',
        '  help                           — this help',
      ].join('\n');
    }

    // Default: broadcast to all agents, interrupting whatever they are doing
    const agents = this.orchestrator.listAgents();
    if (agents.length === 0) return 'No agents available.';
    await this.orchestrator.broadcastHumanMessage(line);
    return `→ Broadcast to all agents (${agents.map(a => a.name).join(', ')})`;
  }

  private async createEscalationTicket(from: string, message: string, urgency: string): Promise<void> {
    if (!this.kanbanPath) return;
    const board = await this.readKanban();
    const id    = `TKT-${String(board.nextSeq).padStart(3, '0')}`;
    board.nextSeq++;
    const now   = new Date().toISOString();
    const shortMsg = message.length > 80 ? `${message.slice(0, 77)}…` : message;
    const priority = urgency === 'high' || urgency === 'critical' ? 'high' : 'medium';
    board.tickets[id] = {
      id,
      title:       `Escalation from ${from}: ${shortMsg}`,
      description: message,
      priority:    priority as never,
      column:      'ready' as never,
      creator:     from,
      assignee:    'human',
      tags:        ['escalation'],
      comments:    [],
      createdAt:   now,
      updatedAt:   now,
    };
    await this.writeKanban(board);
    log.info(`[API] Created escalation ticket ${id} for human from ${from}`);
    // watchKanban fires on file change and broadcasts kanban_update with fresh tickets
  }

  private async addTicketComment(ticketId: string, author: string, text: string): Promise<void> {
    if (!this.kanbanPath) return;
    const board  = await this.readKanban();
    const ticket = board.tickets[ticketId];
    if (!ticket) return;
    ticket.comments.push({ id: `c${Date.now()}`, author, text, ts: new Date().toISOString() });
    ticket.updatedAt = new Date().toISOString();
    await this.writeKanban(board);
  }

  private async updateKanbanColumn(ticketId: string, column: string): Promise<void> {
    if (!this.kanbanPath) return;
    const board  = await this.readKanban();
    const ticket = board.tickets[ticketId];
    if (!ticket || ticket.column === column) return;
    ticket.column    = column as never;
    ticket.updatedAt = new Date().toISOString();
    await this.writeKanban(board);
    log.info(`[API] Ticket ${ticketId} → ${column}`);
    if (column === 'completed') {
      this.unblockDependents(ticketId).catch(() => {});
    }
  }

  /** When a ticket completes, remove it from dependents' blockedBy; auto-ready any fully unblocked tickets. */
  private async unblockDependents(completedId: string): Promise<void> {
    if (!this.kanbanPath) return;
    const board = await this.readKanban();
    const unblocked: Array<typeof board.tickets[string]> = [];
    let changed = false;
    for (const ticket of Object.values(board.tickets)) {
      if (!(ticket.blockedBy ?? []).includes(completedId)) continue;
      ticket.blockedBy = ticket.blockedBy!.filter(b => b !== completedId);
      ticket.updatedAt = new Date().toISOString();
      changed = true;
      if (ticket.blockedBy.length === 0 && ticket.column === 'blocked') {
        ticket.column = 'ready';
        unblocked.push(ticket);
        log.info(`[API] ${ticket.id} unblocked by completion of ${completedId} → ready`);
      }
    }
    if (changed) await this.writeKanban(board);

    // Notify assigned agents that their dependency is resolved
    for (const ticket of unblocked) {
      if (!ticket.assignee) continue;
      const agentName = this.resolveAgentName(ticket.assignee);
      const isKnown = this.orchestrator.listAgents().some(a => a.name.toLowerCase() === agentName.toLowerCase());
      if (!isKnown) continue;
      this.orchestrator.humanMessage(agentName,
        `Good news! ${completedId} has been completed, which unblocks your ticket ${ticket.id}: "${ticket.title}". It's now ready to start.`,
      ).catch(() => {});
    }
  }

  /** Every 30 minutes, nudge agents about stale in_progress or blocked tickets. */
  private async nudgeStaleTickets(): Promise<void> {
    if (!this.kanbanPath) return;
    const board = await this.readKanban();
    const STALE_MS = 30 * 60 * 1000;
    const now = Date.now();
    for (const ticket of Object.values(board.tickets)) {
      if (ticket.column !== 'in_progress' && ticket.column !== 'blocked') continue;
      if (!ticket.assignee) continue;
      const age = now - new Date(ticket.updatedAt).getTime();
      if (age < STALE_MS) continue;
      const agentName = this.resolveAgentName(ticket.assignee);
      const isKnown = this.orchestrator.listAgents().some(a => a.name.toLowerCase() === agentName.toLowerCase());
      if (!isKnown) continue;
      // Only nudge if agent is currently idle
      const activity = this.agentActivity.get(agentName)?.activity ?? '';
      if (activity.toLowerCase().includes('working')) continue;
      const blockers = (ticket.blockedBy ?? []).join(', ');
      const msg = ticket.column === 'blocked' && blockers
        ? `Checking in on ${ticket.id}: "${ticket.title}". It's blocked on [${blockers}]. Are those blockers resolved? If so, update the ticket status.`
        : `Checking in on ${ticket.id}: "${ticket.title}". It's been in progress for a while. Any updates? Please move it to completed if done, or add a comment on current status.`;
      this.orchestrator.humanMessage(agentName, msg).catch(() => {});
      log.info(`[API] Nudged ${agentName} about stale ticket ${ticket.id}`);
    }
  }

  private async dispatchUnstartedTickets(): Promise<void> {
    if (!this.kanbanPath) return;
    const board = await this.readKanban();
    for (const ticket of Object.values(board.tickets)) {
      if (ticket.column === 'in_progress' && ticket.assignee) {
        // Always seed the map so escalation/completion tracking works
        this.agentTicketMap.set(ticket.assignee.toLowerCase(), ticket.id);
        await this.dispatchTicket(ticket);
      }
    }
  }

  private async dispatchTicket(ticket: { id: string; title: string; description: string; assignee?: string; priority?: string; tags?: string[] }): Promise<void> {
    if (!ticket.assignee) return;
    const agentName = this.resolveAgentName(ticket.assignee);
    const isKnown   = this.orchestrator.listAgents().some(a => a.name.toLowerCase() === agentName.toLowerCase());
    if (!isKnown) return;

    // Skip if agent already has an active task for this ticket
    const alreadyActive = (this.orchestrator.listTasks() as Task[]).some(
      t => t.status === 'active' && t.assignedTo.toLowerCase() === agentName.toLowerCase()
        && t.description.includes(ticket.id),
    );
    if (alreadyActive) return;

    // Use ticket.id as the folder name → <project-dir>/tkt-001/
    const projectName = ticket.id;
    const description = `Work on ticket ${ticket.id}: ${ticket.title}${ticket.description ? `\n\n${ticket.description}` : ''}`;
    await this.orchestrator.humanAssignTask(agentName, description, undefined, projectName);
    this.agentTicketMap.set(agentName.toLowerCase(), ticket.id);

    // Look up the folder the orchestrator just created
    const stored = (this.orchestrator.listTasks() as Task[]).find(
      t => t.assignedTo.toLowerCase() === agentName.toLowerCase() && t.description.includes(ticket.id),
    );
    if (stored?.projectFolder && this.kanbanPath) {
      // Persist projectName + projectFolder back to the kanban ticket
      try {
        const board = await this.readKanban();
        const kt = board.tickets[ticket.id];
        if (kt) {
          kt.projectName   = stored.projectName ?? projectName;
          kt.projectFolder = stored.projectFolder;
          kt.updatedAt     = new Date().toISOString();
          await this.writeKanban(board);
        }
      } catch { /* non-fatal */ }

      // Write a README so agents know where to save output
      try {
        const readme = [
          `# ${ticket.id}: ${ticket.title}`,
          '',
          `**Priority:** ${ticket.priority ?? 'medium'}`,
          ticket.assignee ? `**Assignee:** ${ticket.assignee}` : '',
          (ticket.tags?.length ?? 0) > 0 ? `**Tags:** ${ticket.tags!.join(', ')}` : '',
          '',
          '## Description',
          '',
          ticket.description || '(none)',
          '',
          '## Instructions',
          '',
          'Save all outputs, artefacts, and notes in this folder.',
          'Use `write_file`, `read_file`, and `list_files` to manage files here.',
        ].filter(l => l !== undefined).join('\n');
        await writeFile(path.join(stored.projectFolder, 'README.md'), readme, 'utf-8');
      } catch { /* non-fatal */ }
    }

    log.info(`[API] Dispatched ${ticket.id} → ${agentName} (project: ${stored?.projectFolder ?? '?'})`);
  }

  // ── Project switching ─────────────────────────────────────────────────────

  /** Save the current project's orchestrator state to disk (non-blocking on failure). */
  private async launchDueMeetings(): Promise<void> {
    const due = this.orchestrator.listScheduledMeetings().filter(m => {
      return m.status === 'scheduled' && new Date(m.scheduledFor) <= new Date();
    });
    for (const m of due) {
      try {
        log.info(`[API] Auto-launching scheduled meeting "${m.topic}" (${m.id})`);
        await this.orchestrator.launchScheduledMeeting(m.id);
        this.sseBroadcast({ type: 'scheduled_meetings_update', meetings: this.orchestrator.listScheduledMeetings() });
      } catch (err) {
        log.warn(`[API] Failed to launch meeting ${m.id}:`, (err as Error).message);
      }
    }
  }

  private async saveCurrentState(): Promise<void> {
    if (!this.projectDir) return;
    const stateFile = path.join(this.projectDir, 'team-state.json');
    await this.orchestrator.saveState(stateFile);
  }

  /** Assign a random avatar and/or background to any agent that is missing one. */
  private async assignDefaultVisuals(): Promise<void> {
    // Load avatar catalogue and prune entries whose GLB file is missing
    let avatarFiles: string[] = [];
    try {
      const avatarsJsonPath = path.join(AVATARS_DIR, 'avatars.json');
      const raw = await readFile(avatarsJsonPath, 'utf-8');
      const parsed = JSON.parse(raw);
      const catalogue: { file: string }[] = parsed.avatars ?? [];

      const valid: { file: string }[] = [];
      for (const entry of catalogue) {
        try { await stat(path.join(AVATARS_DIR, entry.file)); valid.push(entry); }
        catch { log.warn(`[API] Avatar GLB missing, removing from catalogue: ${entry.file}`); }
      }
      if (valid.length < catalogue.length) {
        parsed.avatars = valid;
        await writeFile(avatarsJsonPath, JSON.stringify(parsed, null, 4), 'utf-8');
      }

      avatarFiles = valid.map(a => a.file);
    } catch { /* no avatars — skip */ }

    // Load background filenames
    let backgroundFiles: string[] = [];
    try {
      await mkdir(BACKGROUNDS_DIR, { recursive: true });
      const entries = await readdir(BACKGROUNDS_DIR);
      backgroundFiles = entries.filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f));
    } catch { /* no backgrounds — skip */ }

    if (avatarFiles.length === 0 && backgroundFiles.length === 0) return;

    const agents = this.orchestrator.listAgents();
    let changed = false;

    // Build sets of already-assigned values so we spread them out
    const usedAvatars = new Set<string>(
      agents.map(a => a.config.identity.avatar).filter((v): v is string => !!v),
    );
    const usedBgs = new Set<string>(
      agents.map(a => a.config.identity.background).filter((v): v is string => !!v),
    );

    // Helper: prefer unused values; if all used, allow repeats
    const nextFrom = (pool: string[], used: Set<string>): string => {
      const unused = pool.filter(x => !used.has(x));
      return unused.length > 0
        ? unused[Math.floor(Math.random() * unused.length)]
        : pool[Math.floor(Math.random() * pool.length)];
    };

    for (const agent of agents) {
      if (!agent.config.identity.avatar && avatarFiles.length > 0) {
        const file = nextFrom(avatarFiles, usedAvatars);
        this.orchestrator.updateAgentAvatar(agent.name, file);
        usedAvatars.add(file);
        changed = true;
      }
      if (!agent.config.identity.background && backgroundFiles.length > 0) {
        const file = nextFrom(backgroundFiles, usedBgs);
        this.orchestrator.updateAgentBackground(agent.name, file);
        usedBgs.add(file);
        changed = true;
      }
    }

    if (changed) {
      log.info('[API] Assigned default avatars/backgrounds to agents');
      await this.saveCurrentState().catch(() => {});
    }
  }

  private metaFilePath(): string | null {
    return this.projectDir ? path.join(this.projectDir, 'project-meta.json') : null;
  }

  private async readProjectMeta(): Promise<Record<string, string>> {
    const fp = this.metaFilePath();
    if (!fp) return {};
    try { return JSON.parse(await readFile(fp, 'utf-8')) as Record<string, string>; }
    catch { return {}; }
  }

  private async writeProjectMeta(meta: Record<string, string>): Promise<void> {
    const fp = this.metaFilePath();
    if (!fp) return;
    await writeFile(fp, JSON.stringify(meta, null, 2), 'utf-8');
  }

  private async getProjectMeta(key: string): Promise<string | undefined> {
    return (await this.readProjectMeta())[key];
  }

  private async setProjectMeta(key: string, value: string): Promise<void> {
    const meta = await this.readProjectMeta();
    meta[key] = value;
    await this.writeProjectMeta(meta);
  }

  private async getProjectGoal(): Promise<string> {
    return (await this.getProjectMeta('goal')) ?? '';
  }

  private async setProjectGoal(goal: string): Promise<void> {
    await this.setProjectMeta('goal', goal);
  }

  /** Graceful shutdown — saves current project state then stops the server. */
  async shutdown(): Promise<void> {
    this.stop();
    await this.saveCurrentState();
  }

  private async ensureProjectFolders(dir: string): Promise<void> {
    await mkdir(path.join(dir, 'sources'), { recursive: true });
    await mkdir(path.join(dir, 'outputs'), { recursive: true });
  }

  private async initTelemetryStore(filePath: string): Promise<void> {
    this.telemetry = new TelemetryStore(filePath);
    await this.telemetry.init().catch((err: Error) =>
      log.warn('[API] Telemetry init error:', err.message),
    );
    this.orchestrator.setTelemetryRecorder((entry) => {
      if (!this.telemetry) return;
      this.telemetry.record({ ts: new Date().toISOString(), ...entry }).then(() => {
        this.sseBroadcast({ type: 'telemetry_update', summary: this.telemetry!.getSummary() });
      }).catch(() => {});
    });
  }

  private async switchProject(newId: string): Promise<void> {
    if (!this.projectLoader || !this.projectsRoot) throw new Error('Project loader not configured');

    const newProjectDir   = path.join(this.projectsRoot, newId);
    const newKanbanFile   = path.join(newProjectDir, 'kanban-board.json');
    const newStateFile    = path.join(newProjectDir, 'team-state.json');
    const newMcpFile      = path.join(newProjectDir, 'mcp-enabled.json');
    const newMeetingsFile = path.join(newProjectDir, 'meetings.json');

    await mkdir(newProjectDir, { recursive: true });

    // 1. Save current project state (non-destructive — keeps event store open)
    if (this.projectDir) {
      const oldStateFile = path.join(this.projectDir, 'team-state.json');
      await this.orchestrator.saveState(oldStateFile);
      log.info(`[API] Saved state for project "${this.projectId}"`);
    }

    // 2. Unsubscribe events and stop kanban watcher
    this.unsubscribeEvents?.();
    this.kanbanWatcher?.close();
    this.kanbanWatcher = null;

    // 3. Clear all in-memory per-project state
    this.agentActivity.clear();
    this.agentFeeds.clear();
    this.agentTicketMap.clear();
    this.talkingTimers.forEach(t => clearTimeout(t));
    this.talkingTimers.clear();
    this.enabledMCPIds.clear();

    // Disconnect project-scoped MCP servers from the old orchestrator so they
    // can be restarted with the new project dir by loadMCPEnabled() below.
    if (this.orchestrator.hasMCPServer('filesystem')) {
      await this.orchestrator.removeMCPServer('filesystem').catch(() => {});
    }

    // 4. Load new project via the factory
    log.info(`[API] Switching to project "${newId}" (${newProjectDir})`);
    const newOrchestrator = await this.projectLoader(newProjectDir, newKanbanFile, newStateFile);

    // 5. Wire up the new orchestrator
    this.orchestrator    = newOrchestrator;
    this.kanbanPath      = newKanbanFile;
    this.mcpEnabledPath  = newMcpFile;
    this.meetingsPath    = newMeetingsFile;
    this.projectId       = newId;
    this.projectDir      = newProjectDir;
    await newOrchestrator.initMeetingStore(newMeetingsFile).catch(() => {});

    // Ensure project folder structure and wire project dir/goal/humanName into agents
    await this.ensureProjectFolders(newProjectDir);
    newOrchestrator.setProjectDir(newProjectDir);
    const newMeta = await this.readProjectMeta();
    if (newMeta['goal']) newOrchestrator.setProjectGoal(newMeta['goal']);
    if (newMeta['humanName']) newOrchestrator.setHumanName(newMeta['humanName']);

    // Switch telemetry to new project
    const newTelemetryFile = path.join(newProjectDir, 'telemetry.jsonl');
    await this.initTelemetryStore(newTelemetryFile);

    this.unsubscribeEvents = this.orchestrator.onEvent((ev) => {
      this.handleOrchestratorEvent(ev);
      this.wsBroadcast(ev);
    });

    this.watchKanban(newKanbanFile);
    await this.loadMCPEnabled().catch(() => {});

    // Assign avatars/backgrounds to any agents that don't have them
    await this.assignDefaultVisuals().catch(() => {});

    // 6. Push a full init event to all connected browser tabs
    const agents       = this.buildAgentStatuses();
    const tickets      = await this.readTickets().catch(() => []);
    const broadcastMeta = await this.readProjectMeta();
    const project      = { id: this.projectId, dir: this.projectDir, goal: broadcastMeta['goal'] ?? '', humanName: broadcastMeta['humanName'] ?? 'Human' };
    this.sseBroadcast({ type: 'init', agents, tickets, project } as never);
    this.sseBroadcast({ type: 'telemetry_update', summary: this.telemetry?.getSummary() ?? null });

    // 7. Dispatch in_progress kanban tickets that have no active orchestrator task
    this.dispatchUnstartedTickets().catch(() => {});

    log.info(`[API] Project switched to "${newId}"`);

    // Notify external components (e.g. CLIInterface) of the new orchestrator
    this.projectSwitchCallback?.(newOrchestrator);
  }

  private resolveAgentName(input: string): string {
    const lower = input.toLowerCase();
    const match = this.orchestrator.listAgents().find(a => a.name.toLowerCase() === lower);
    return match ? match.name : input;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Construct an AIProvider from a provider ID string. Returns null for unknown IDs. */
function makeProvider(id: string): AIProvider | null {
  switch (id) {
    case 'anthropic': return new AnthropicProvider();
    case 'openai':    return new OpenAIProvider();
    case 'gemini':    return new GeminiProvider();
    case 'ollama':    return new OllamaProvider();
    case 'lmstudio':  return new LMStudioProvider();
    default:          return null;
  }
}

const KNOWN_PROVIDERS = [
  {
    id: 'anthropic', label: 'Anthropic',
    envKey: 'ANTHROPIC_API_KEY', modelEnvKey: 'ANTHROPIC_MODEL',
    models: [
      "claude-opus-4-6", 
      "claude-sonnet-4-6", 
      "claude-opus-4-5", 
      "claude-sonnet-4-5", 
      "claude-haiku-4-5", 
      "claude-opus-4-1-20250805", 
      "claude-opus-4-20250514", 
      "claude-sonnet-4-20250514",
      "claude-3-haiku-20240307"
    ],
  },
  {
    id: 'openai', label: 'OpenAI',
    envKey: 'OPENAI_API_KEY', modelEnvKey: 'OPENAI_MODEL',
    models: [  
      "gpt-5",
      "gpt-5-mini",
      "gpt-5-nano", 
      "gpt-4.1",
      "gpt-4.1-mini",
      "gpt-4.1-nano", 
      "o3",
      "o3-mini", 
      "o1",
      "o1-mini", 
      "gpt-4o",
      "gpt-4o-mini", 
    ],

  },
  {
    id: 'gemini', label: 'Google Gemini',
    envKey: 'GEMINI_API_KEY', modelEnvKey: 'GEMINI_MODEL',
    models: [
      "gemini-3.1-pro-preview",
      "gemini-3.1-flash-lite-preview",
      "gemini-3.1-flash-preview",
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.0-flash",
      "gemini-1.5-pro"
    ],
  },
  {
    id: 'ollama', label: 'Ollama (local)',
    envKey: '', modelEnvKey: 'OLLAMA_MODEL',
    baseUrlEnvKey: 'OLLAMA_BASE_URL',
    defaultBaseUrl: 'http://localhost:11434/v1',
    models: ['llama3.3', 'llama3.2', 'llama3.1', 'mistral', 'mixtral', 'phi4', 'phi3', 'gemma3', 'qwen2.5', 'deepseek-r1'],
  },
  {
    id: 'lmstudio', label: 'LM Studio (local)',
    envKey: '', modelEnvKey: 'LM_STUDIO_MODEL',
    baseUrlEnvKey: 'LM_STUDIO_BASE_URL',
    defaultBaseUrl: 'http://localhost:1234/v1',
    models: [],
  },
];

/**
 * Probe a local LLM server.  Tries the OpenAI-compat /v1/models endpoint first;
 * if that returns a non-OK status (e.g. older Ollama that only exposes /api/tags)
 * falls back to the server root derived by stripping the /v1 path suffix.
 */
async function probeLocalLLM(baseUrl: string): Promise<boolean> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 3000);
  try {
    const openAIUrl = baseUrl.replace(/\/+$/, '') + '/models';
    const res = await fetch(openAIUrl, { signal: abort.signal });
    clearTimeout(timer);
    if (res.ok) {
      log.info(`[Probe] ${baseUrl} → OK via /models`);
      return true;
    }
    // Non-OK (e.g. 404 on older Ollama) — try the server root as a health check
    const rootUrl = baseUrl.replace(/\/v1\/?$/, '');
    if (rootUrl === baseUrl.replace(/\/+$/, '')) {
      log.info(`[Probe] ${baseUrl} → offline (HTTP ${res.status})`);
      return false; // no /v1 to strip
    }
    const res2 = await fetch(rootUrl, { signal: abort.signal });
    log.info(`[Probe] ${baseUrl} → ${res2.ok ? 'OK via root' : `offline (HTTP ${res2.status})`}`);
    return res2.ok;
  } catch (err) {
    clearTimeout(timer);
    log.info(`[Probe] ${baseUrl} → offline (${(err as Error).message})`);
    return false;
  }
}

// ── Live model fetching with TTL cache ────────────────────────────────────────

const TTL_DEFAULT = 24 * 60 * 60 * 1000; // 24 hours for cloud providers
const TTL_LOCAL   =  5 * 60 * 1000;       // 5 minutes for local servers

const modelCache = new Map<string, { models: string[]; ts: number }>();

function modelCacheTtl(providerId: string): number {
  return (providerId === 'ollama' || providerId === 'lmstudio') ? TTL_LOCAL : TTL_DEFAULT;
}

type KnownProvider = typeof KNOWN_PROVIDERS[number];

/** Fetch live model IDs from a provider's API. Returns [] on any error. */
async function fetchLiveModels(p: KnownProvider): Promise<string[]> {
  try {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 5000);

    let models: string[] = [];

    if (p.id === 'anthropic') {
      const key = process.env['ANTHROPIC_API_KEY'];
      if (!key) { log.info('[Models] anthropic: no API key, skipping'); return []; }
      const r = await fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        signal: abort.signal,
      });
      clearTimeout(timer);
      if (!r.ok) { log.warn(`[Models] anthropic: HTTP ${r.status}`); return []; }
      const data = await r.json() as { data: Array<{ id: string }> };
      models = data.data.map(m => m.id).sort();
      log.info(`[Models] anthropic: ${models.length} model(s)`);

    } else if (p.id === 'openai') {
      const key = process.env['OPENAI_API_KEY'];
      if (!key) { log.info('[Models] openai: no API key, skipping'); return []; }
      const r = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${key}` },
        signal: abort.signal,
      });
      clearTimeout(timer);
      if (!r.ok) { log.warn(`[Models] openai: HTTP ${r.status}`); return []; }
      const data = await r.json() as { data: Array<{ id: string }> };
      models = data.data
        .map(m => m.id)
        .filter(id => /^(gpt-|o1|o3|o4)/.test(id))
        .sort();
      log.info(`[Models] openai: ${models.length} model(s)`);

    } else if (p.id === 'gemini') {
      const key = process.env['GEMINI_API_KEY'];
      if (!key) { log.info('[Models] gemini: no API key, skipping'); return []; }
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
        { signal: abort.signal },
      );
      clearTimeout(timer);
      if (!r.ok) { log.warn(`[Models] gemini: HTTP ${r.status}`); return []; }
      const data = await r.json() as { models: Array<{ name: string; supportedGenerationMethods?: string[] }> };
      models = data.models
        .filter(m => (m.supportedGenerationMethods ?? []).includes('generateContent'))
        .map(m => m.name.replace(/^models\//, ''))
        .sort();
      log.info(`[Models] gemini: ${models.length} model(s)`);

    } else if (p.id === 'ollama' || p.id === 'lmstudio') {
      const baseUrl = (p.baseUrlEnvKey ? process.env[p.baseUrlEnvKey] : undefined) || p.defaultBaseUrl || '';
      if (!baseUrl) { log.warn(`[Models] ${p.id}: no base URL configured`); return []; }

      const openAIUrl = baseUrl.replace(/\/+$/, '') + '/models';
      log.info(`[Models] ${p.id}: trying ${openAIUrl}`);
      let r = await fetch(openAIUrl, { signal: abort.signal });

      if (!r.ok && p.id === 'ollama') {
        // Older Ollama versions don't expose /v1/models — fall back to native /api/tags
        const nativeUrl = baseUrl.replace(/\/v1\/?$/, '') + '/api/tags';
        log.info(`[Models] ollama: /v1/models returned ${r.status}, trying native ${nativeUrl}`);
        r = await fetch(nativeUrl, { signal: abort.signal });
      }

      clearTimeout(timer);
      if (!r.ok) { log.warn(`[Models] ${p.id}: HTTP ${r.status} from ${r.url}`); return []; }

      const data = await r.json() as { data?: Array<{ id: string }>; models?: Array<{ name: string }> };
      if (data.data)        models = data.data.map(m => m.id).sort();   // OpenAI-compat
      else if (data.models) models = data.models.map(m => m.name).sort(); // Ollama native /api/tags
      log.info(`[Models] ${p.id}: ${models.length} model(s) — ${models.slice(0, 5).join(', ')}${models.length > 5 ? '…' : ''}`);
    }

    return models;
  } catch (err) {
    log.warn(`[Models] ${p.id}: fetch failed — ${(err as Error).message}`);
    return [];
  }
}

/** Return cached models for a provider, fetching live if the cache is stale. Falls back to static list. */
async function getCachedModels(p: KnownProvider): Promise<string[]> {
  const cached = modelCache.get(p.id);
  if (cached && (Date.now() - cached.ts) < modelCacheTtl(p.id)) {
    log.info(`[Models] ${p.id}: serving ${cached.models.length} model(s) from cache`);
    return cached.models;
  }
  const live = await fetchLiveModels(p);
  if (live.length > 0) {
    modelCache.set(p.id, { models: live, ts: Date.now() });
    return live;
  }
  // Don't cache failures — try again next time
  if (p.models.length > 0) log.info(`[Models] ${p.id}: live fetch empty, using ${p.models.length} static fallback(s)`);
  return p.models;
}

function stateLabel(state: string): string {
  switch (state) {
    case 'idle':             return 'Ready';
    case 'working':          return 'Working…';
    case 'waiting_for_help': return 'Waiting for help…';
    case 'in_discussion':    return 'In discussion';
    default:                 return state;
  }
}

type Priority = 'low' | 'medium' | 'high' | 'critical';
type Column   = 'backlog' | 'ready' | 'in_progress' | 'blocked' | 'completed';

function buildBoardSummary(board: Board, includeBacklog: boolean) {
  const columns: Column[] = includeBacklog
    ? ['backlog', 'ready', 'in_progress', 'blocked', 'completed']
    : ['ready', 'in_progress', 'blocked', 'completed'];

  const pri: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const result: Record<string, { count: number; tickets: unknown[] }> = {};

  for (const col of columns) {
    const tickets = Object.values(board.tickets)
      .filter((t) => t.column === col)
      .sort((a, b) =>
        (pri[a.priority as Priority] - pri[b.priority as Priority]) ||
        a.createdAt.localeCompare(b.createdAt),
      )
      .map((t) => ({ id: t.id, title: t.title, priority: t.priority, assignee: t.assignee, tags: t.tags, updatedAt: t.updatedAt }));
    result[col] = { count: tickets.length, tickets };
  }
  return result;
}


async function listFilesRecursive(
  dir: string,
  projectDir: string,
  relBase = '',
): Promise<Array<{ name: string; relativePath: string; size: number; modified: string; isDir: boolean }>> {
  const results: Array<{ name: string; relativePath: string; size: number; modified: string; isDir: boolean }> = [];
  let entries: fs.Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push({ name: entry.name, relativePath: rel, size: 0, modified: '', isDir: true });
      const children = await listFilesRecursive(path.join(dir, entry.name), projectDir, rel);
      results.push(...children);
    } else {
      try {
        const s = await stat(path.join(dir, entry.name));
        results.push({ name: entry.name, relativePath: rel, size: s.size, modified: s.mtime.toISOString(), isDir: false });
      } catch { /* skip */ }
    }
  }
  return results;
}
