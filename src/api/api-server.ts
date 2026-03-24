import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFile, writeFile, mkdir } from 'fs/promises';
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
import { OpenAIProvider } from '../providers/openai.js';
import { GeminiProvider } from '../providers/gemini.js';
import { AIProvider } from '../providers/types.js';
import { HatType } from '../hats/types.js';
import { readEnvFile, writeEnvFile } from './env-manager.js';
import { processSpeech, isSpeechAvailable } from '../speech/pipeline.js';

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

const AVATARS_DIR = path.join(process.cwd(), 'avatars');

// ── Types ─────────────────────────────────────────────────────────────────────

interface AgentStatus {
  name:       string;
  hatType:    string;
  state:      string;
  activity:   string;
  talkingTo?: string;
  model?:     string;
  provider?:  string;
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

  private unsubscribeEvents: (() => void) | null = null;

  // Which agent name each WS client wants speech for (null = none)
  private speechInterest = new Map<WebSocket, string>();

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
        console.error('[API] Request error:', err);
        if (!res.headersSent) { res.writeHead(500); res.end('Internal error'); }
      });
    });
    this.wss = new WebSocketServer({ server: this.server });
    this.wss.on('connection', (ws) => this.handleWsConnection(ws));
  }

  start(): void {
    // Subscribe to orchestrator events
    this.unsubscribeEvents = this.orchestrator.onEvent((ev) => {
      this.handleOrchestratorEvent(ev);
      this.wsBroadcast(ev);
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

    // Dispatch any in_progress kanban tickets that have no active orchestrator task
    if (this.kanbanPath) this.dispatchUnstartedTickets().catch(() => {});

    // Watch kanban file
    if (this.kanbanPath) this.watchKanban(this.kanbanPath);

    this.server.listen(this.port, () => {
      console.log(`[API] UI    http://localhost:${this.port}`);
      console.log(`[API] REST  http://localhost:${this.port}/api`);
      console.log(`[API] WS    ws://localhost:${this.port}/ws`);
      if (isSpeechAvailable()) {
        console.log(`[API] Speech TTS enabled (model: ${process.env['PIPER_MODEL']})`);
      }
    });
  }

  stop(): void {
    this.unsubscribeEvents?.();
    this.kanbanWatcher?.close();
    if (this.meetingScheduler) { clearInterval(this.meetingScheduler); this.meetingScheduler = null; }
    this.wss.close();
    this.server.close();
  }

  // ── WebSocket (raw event stream for programmatic clients) ─────────────────

  private handleWsConnection(ws: WebSocket): void {
    const snapshot = this.buildTeamSnapshot();
    ws.send(JSON.stringify({ type: 'snapshot', data: snapshot }));

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type: string; name?: string };
        if (msg.type === 'set_speech_agent') {
          if (msg.name) this.speechInterest.set(ws, msg.name);
          else           this.speechInterest.delete(ws);
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
    const agents  = this.buildAgentStatuses();
    const tickets = this.kanbanPath ? await this.readTickets() : [];
    const project = { id: this.projectId, dir: this.projectDir };
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
          this.setActivity(to, (task ?? 'Working on task').slice(0, 70));
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
          const snippet = (content ?? '').replace(/\s+/g, ' ').trim().slice(0, 70);
          this.setActivity(from, snippet || 'Responded');
          changed = true;
          this.sseBroadcast({ type: 'cli_output', kind: 'agent', from, content: content ?? '' });

          // Speech synthesis — send to any WS client interested in this agent
          if (content && isSpeechAvailable()) {
            const interested = [...this.speechInterest.entries()]
              .filter(([, name]) => name === from)
              .map(([ws]) => ws);
            if (interested.length > 0) {
              processSpeech(content, from, (chunk) => {
                const msg = JSON.stringify({ type: 'speech_chunk', data: chunk });
                for (const ws of interested) {
                  if (ws.readyState === WebSocket.OPEN) ws.send(msg);
                }
              }).catch((err: Error) =>
                console.warn(`[Speech] Pipeline error for ${from}:`, err.message),
              );
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
        const label = `Meeting: ${(topic ?? '').slice(0, 50)}`;
        for (const name of [facilitator, ...(participants ?? [])].filter(Boolean) as string[]) {
          this.setActivity(name, label);
        }
        changed = true;
        break;
      }
      case 'escalation': {
        const from    = ev['from'] as string | undefined;
        const message = ev['message'] as string | undefined;
        if (from) {
          this.setActivity(from, 'Waiting for human…');
          changed = true;
          this.sseBroadcast({ type: 'cli_output', kind: 'escalation', from, content: message ?? '' });
          const ticketId = this.agentTicketMap.get(from.toLowerCase());
          if (ticketId) {
            this.updateKanbanColumn(ticketId, 'blocked').catch(() => {});
            if (message) this.addTicketComment(ticketId, from, `Blocked: ${message}`).catch(() => {});
          }
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
        name:      a.name,
        hatType:   a.hatType,
        state:     a.state,
        activity:  extra?.activity ?? stateLabel(a.state),
        talkingTo: extra?.talkingTo,
        model:     a.config.model,
        provider:  a.config.provider.name,
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

    if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'PATCH' && req.method !== 'DELETE') {
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
        column?: string; assignee?: string; tags?: string[];
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
        comments:    [],
        createdAt:   now,
        updatedAt:   now,
      };
      await writeFile(this.kanbanPath, JSON.stringify(board, null, 2), 'utf-8');
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
      await writeFile(this.kanbanPath, JSON.stringify(board, null, 2), 'utf-8');
      this.json(res, 201, comment);

    } else if (pathname.startsWith('/api/kanban/tickets/') && req.method === 'PATCH') {
      if (!this.kanbanPath) { this.json(res, 404, { error: 'Kanban not configured' }); return; }
      const id     = pathname.replace('/api/kanban/tickets/', '');
      const body   = await this.readBody(req);
      const fields = JSON.parse(body) as Partial<{
        title: string; description: string; priority: string;
        column: string; assignee: string | null; tags: string[];
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
      ticket.updatedAt = new Date().toISOString();
      await writeFile(this.kanbanPath, JSON.stringify(board, null, 2), 'utf-8');
      this.json(res, 200, ticket);

      // Dispatch to agent if ticket is now in_progress and either column or assignee changed
      const columnChanged   = fields.column   !== undefined && prevColumn   !== ticket.column;
      const assigneeChanged = fields.assignee !== undefined && prevAssignee !== ticket.assignee;
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
        const config = resolveConfig(entry.config);
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
        this.json(res, 200, { ok: true, id: this.projectId });
      } catch (err) {
        this.json(res, 500, { error: (err as Error).message });
      }

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
      const providers = KNOWN_PROVIDERS.map(p => ({
        ...p,
        available: !!process.env[p.envKey],
        defaultModel: process.env[p.modelEnvKey] ?? p.models[0],
      }));
      this.json(res, 200, providers);

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

    } else if (pathname.match(/^\/api\/agents\/[^/]+\/config$/) && req.method === 'PATCH') {
      const agentName = decodeURIComponent(pathname.slice('/api/agents/'.length, -'/config'.length));
      const body = await this.readBody(req);
      const { provider: providerName, model } = JSON.parse(body) as { provider: string; model: string };
      if (!model?.trim()) { this.json(res, 400, { error: 'model is required' }); return; }
      let provider: AIProvider;
      if (providerName === 'anthropic') {
        provider = new AnthropicProvider();
      } else if (providerName === 'openai') {
        provider = new OpenAIProvider();
      } else if (providerName === 'gemini') {
        provider = new GeminiProvider();
      } else {
        this.json(res, 400, { error: `Unknown provider "${providerName}"` }); return;
      }
      try {
        this.orchestrator.updateAgentConfig(this.resolveAgentName(agentName), provider, model.trim());
        this.sseBroadcast({ type: 'agent_update', agents: this.buildAgentStatuses() });
        this.saveCurrentState().catch(() => {});
        this.json(res, 200, { ok: true });
      } catch (err) {
        this.json(res, 404, { error: (err as Error).message });
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
      let provider: AIProvider;
      if (providerName === 'openai') {
        provider = new OpenAIProvider();
      } else if (providerName === 'gemini') {
        provider = new GeminiProvider();
      } else {
        provider = new AnthropicProvider();
      }
      const resolvedModel = model?.trim() || (
        providerName === 'openai'  ? (process.env['OPENAI_MODEL']  ?? 'gpt-4.1-mini') :
        providerName === 'gemini'  ? (process.env['GEMINI_MODEL']  ?? 'gemini-2.5-flash') :
                                     (process.env['ANTHROPIC_MODEL'] ?? 'claude-haiku-4-5-20251001')
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
            if (changed) await writeFile(this.kanbanPath, JSON.stringify(board, null, 2), 'utf-8');
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
        console.log(`[Debug] Prompt logging ${enabled ? 'ON' : 'OFF'}`);
      }
      this.json(res, 200, { logPrompts: debugState.logPrompts });

    } else if (pathname === '/api/cli' && req.method === 'POST') {
      const body   = await this.readBody(req);
      const { line } = JSON.parse(body) as { line: string };
      const output = await this.handleCLICommand(line?.trim() ?? '');
      this.json(res, 200, { output });

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

    } else if (pathname.match(/^\/api\/scheduled-meetings\/[^/]+\/launch$/) && req.method === 'POST') {
      const id = pathname.replace('/api/scheduled-meetings/', '').replace('/launch', '');
      try {
        await this.orchestrator.launchScheduledMeeting(id);
        this.sseBroadcast({ type: 'scheduled_meetings_update', meetings: this.orchestrator.listScheduledMeetings() });
        this.json(res, 200, { ok: true });
      } catch (err) {
        this.json(res, 400, { error: (err as Error).message });
      }

    } else if (pathname === '/api/avatars') {
      try {
        const raw = await readFile(path.join(AVATARS_DIR, 'avatars.json'), 'utf-8');
        this.json(res, 200, JSON.parse(raw));
      } catch {
        this.json(res, 404, { avatars: [] });
      }

    } else if (pathname.startsWith('/api/')) {
      this.json(res, 404, { error: 'Not found' });

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

  private json(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  private async loadMCPEnabled(): Promise<void> {
    try {
      const raw = await readFile(this.mcpEnabledPath, 'utf-8');
      const data = JSON.parse(raw) as { ids: string[] };
      for (const id of data.ids ?? []) {
        const entry = MCP_CATALOGUE.find(e => e.id === id);
        if (!entry || this.orchestrator.hasMCPServer(id)) continue;
        try {
          const config = resolveConfig(entry.config);
          await this.orchestrator.addMCPServer({ name: id, config });
          this.enabledMCPIds.add(id);
        } catch (err) {
          console.warn(`[MCP] Failed to reconnect "${id}":`, (err as Error).message);
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
        '  @AgentName message             — DM a specific agent',
        '  task AgentName: text           — assign a task',
        '  task AgentName [name]: text    — assign with project name',
        '  reply AgentName: text          — reply to escalation',
        '  status                         — show agent states',
        '  tasks                          — list tasks',
        '  meetings                       — list meetings',
        '  resume                         — re-deliver active tasks',
        '  help                           — this help',
        '',
        'Default: sends to the blue-hat agent (or first agent)',
      ].join('\n');
    }

    // Default: send to blue hat agent or first agent
    const agents = this.orchestrator.listAgents();
    if (agents.length === 0) return 'No agents available.';
    const defaultAgent = agents.find(a => String(a.hatType).toLowerCase() === 'blue') ?? agents[0];
    await this.orchestrator.humanMessage(defaultAgent.name, line);
    return `→ Sent to ${defaultAgent.name}`;
  }

  private async addTicketComment(ticketId: string, author: string, text: string): Promise<void> {
    if (!this.kanbanPath) return;
    const board  = await this.readKanban();
    const ticket = board.tickets[ticketId];
    if (!ticket) return;
    ticket.comments.push({ id: `c${Date.now()}`, author, text, ts: new Date().toISOString() });
    ticket.updatedAt = new Date().toISOString();
    await writeFile(this.kanbanPath, JSON.stringify(board, null, 2), 'utf-8');
  }

  private async updateKanbanColumn(ticketId: string, column: string): Promise<void> {
    if (!this.kanbanPath) return;
    const board  = await this.readKanban();
    const ticket = board.tickets[ticketId];
    if (!ticket || ticket.column === column) return;
    ticket.column    = column as never;
    ticket.updatedAt = new Date().toISOString();
    await writeFile(this.kanbanPath, JSON.stringify(board, null, 2), 'utf-8');
    console.log(`[API] Ticket ${ticketId} → ${column}`);
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
          await writeFile(this.kanbanPath, JSON.stringify(board, null, 2), 'utf-8');
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

    console.log(`[API] Dispatched ${ticket.id} → ${agentName} (project: ${stored?.projectFolder ?? '?'})`);
  }

  // ── Project switching ─────────────────────────────────────────────────────

  /** Save the current project's orchestrator state to disk (non-blocking on failure). */
  private async launchDueMeetings(): Promise<void> {
    const due = this.orchestrator.listScheduledMeetings().filter(m => {
      return m.status === 'scheduled' && new Date(m.scheduledFor) <= new Date();
    });
    for (const m of due) {
      try {
        console.log(`[API] Auto-launching scheduled meeting "${m.topic}" (${m.id})`);
        await this.orchestrator.launchScheduledMeeting(m.id);
        this.sseBroadcast({ type: 'scheduled_meetings_update', meetings: this.orchestrator.listScheduledMeetings() });
      } catch (err) {
        console.warn(`[API] Failed to launch meeting ${m.id}:`, (err as Error).message);
      }
    }
  }

  private async saveCurrentState(): Promise<void> {
    if (!this.projectDir) return;
    const stateFile = path.join(this.projectDir, 'team-state.json');
    await this.orchestrator.saveState(stateFile);
  }

  /** Graceful shutdown — saves current project state then stops the server. */
  async shutdown(): Promise<void> {
    this.stop();
    await this.saveCurrentState();
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
      console.log(`[API] Saved state for project "${this.projectId}"`);
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

    // 4. Load new project via the factory
    console.log(`[API] Switching to project "${newId}" (${newProjectDir})`);
    const newOrchestrator = await this.projectLoader(newProjectDir, newKanbanFile, newStateFile);

    // 5. Wire up the new orchestrator
    this.orchestrator    = newOrchestrator;
    this.kanbanPath      = newKanbanFile;
    this.mcpEnabledPath  = newMcpFile;
    this.meetingsPath    = newMeetingsFile;
    this.projectId       = newId;
    this.projectDir      = newProjectDir;
    await newOrchestrator.initMeetingStore(newMeetingsFile).catch(() => {});

    this.unsubscribeEvents = this.orchestrator.onEvent((ev) => {
      this.handleOrchestratorEvent(ev);
      this.wsBroadcast(ev);
    });

    this.watchKanban(newKanbanFile);
    await this.loadMCPEnabled().catch(() => {});

    // 6. Push a full init event to all connected browser tabs
    const agents  = this.buildAgentStatuses();
    const tickets = await this.readTickets().catch(() => []);
    const project = { id: this.projectId, dir: this.projectDir };
    this.sseBroadcast({ type: 'init', agents, tickets, project } as never);

    // 7. Dispatch in_progress kanban tickets that have no active orchestrator task
    this.dispatchUnstartedTickets().catch(() => {});

    console.log(`[API] Project switched to "${newId}"`);
  }

  private resolveAgentName(input: string): string {
    const lower = input.toLowerCase();
    const match = this.orchestrator.listAgents().find(a => a.name.toLowerCase() === lower);
    return match ? match.name : input;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
];

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
