import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFile, writeFile } from 'fs/promises';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { TeamOrchestrator } from '../orchestrator/orchestrator.js';
import { StoredEvent } from '../store/event-store.js';
import { Board } from '../mcp/kanban/types.js';
import { MCP_CATALOGUE, resolveConfig } from '../mcp/mcp-catalogue.js';

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
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface AgentStatus {
  name:       string;
  hatType:    string;
  state:      string;
  activity:   string;
  talkingTo?: string;
  model?:     string;
}

// ── Config ────────────────────────────────────────────────────────────────────

export interface APIServerConfig {
  port?:            number;   // default 3001
  kanbanPath?:      string;   // path to kanban-board.json; omit to disable kanban endpoints
  mcpEnabledPath?:  string;   // path to persist enabled MCP servers; default './mcp-enabled.json'
}

// ── Server ────────────────────────────────────────────────────────────────────

export class APIServer {
  private server;
  private wss: WebSocketServer;
  private orchestrator: TeamOrchestrator;
  private kanbanPath: string | null;
  private port: number;
  private mcpEnabledPath: string;
  private enabledMCPIds: Set<string> = new Set();

  // SSE clients (browser dashboard)
  private sseClients: ServerResponse[] = [];

  // Agent activity layer — updated from orchestrator events
  private agentActivity = new Map<string, { activity: string; talkingTo?: string }>();
  private talkingTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // Kanban file watcher
  private kanbanWatcher: fs.FSWatcher | null = null;
  private kanbanDebounce: ReturnType<typeof setTimeout> | null = null;

  private unsubscribeEvents: (() => void) | null = null;

  constructor(orchestrator: TeamOrchestrator, config: APIServerConfig = {}) {
    this.orchestrator = orchestrator;
    this.kanbanPath   = config.kanbanPath ?? null;
    this.port         = config.port ?? 3001;
    this.mcpEnabledPath = config.mcpEnabledPath ?? './mcp-enabled.json';

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

    // Watch kanban file
    if (this.kanbanPath) this.watchKanban(this.kanbanPath);

    this.server.listen(this.port, () => {
      console.log(`[API] UI    http://localhost:${this.port}`);
      console.log(`[API] REST  http://localhost:${this.port}/api`);
      console.log(`[API] WS    ws://localhost:${this.port}/ws`);
    });
  }

  stop(): void {
    this.unsubscribeEvents?.();
    this.kanbanWatcher?.close();
    this.wss.close();
    this.server.close();
  }

  // ── WebSocket (raw event stream for programmatic clients) ─────────────────

  private handleWsConnection(ws: WebSocket): void {
    const snapshot = this.buildTeamSnapshot();
    ws.send(JSON.stringify({ type: 'snapshot', data: snapshot }));
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
    res.write(`data: ${JSON.stringify({ type: 'init', agents, tickets })}\n\n`);
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
        }
        break;
      }
      case 'task_complete': {
        const agent = ev['agent'] as string | undefined;
        if (agent) { this.setActivity(agent, 'Task complete'); changed = true; }
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
        const from = ev['from'] as string | undefined;
        if (from) { this.setActivity(from, 'Waiting for human…'); changed = true; }
        break;
      }
      case 'mcp_server_added':
        this.sseBroadcast({ type: 'tools_update', tools: this.orchestrator.getToolInfo() });
        break;
    }

    if (changed) {
      this.sseBroadcast({ type: 'agent_update', agents: this.buildAgentStatuses() });
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
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
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

    if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'PATCH') {
      this.json(res, 405, { error: 'Method not allowed' }); return;
    }

    // ── REST API ─────────────────────────────────────────────────────────────

    if (pathname === '/api/team') {
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

    } else if (pathname === '/api/kanban/tickets') {
      if (!this.kanbanPath) { this.json(res, 404, { error: 'Kanban not configured' }); return; }
      const board    = await this.readKanban();
      const column   = url.searchParams.get('column') ?? undefined;
      const assignee = url.searchParams.get('assignee') ?? undefined;
      let tickets    = Object.values(board.tickets);
      if (column)   tickets = tickets.filter((t) => t.column === column);
      if (assignee) tickets = tickets.filter((t) => t.assignee === assignee);
      this.json(res, 200, tickets);

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
      if (fields.title       !== undefined) ticket.title       = fields.title;
      if (fields.description !== undefined) ticket.description = fields.description;
      if (fields.priority    !== undefined) ticket.priority    = fields.priority as never;
      if (fields.column      !== undefined) ticket.column      = fields.column   as never;
      if (fields.assignee    !== undefined) ticket.assignee    = fields.assignee ?? undefined;
      if (fields.tags        !== undefined) ticket.tags        = fields.tags;
      ticket.updatedAt = new Date().toISOString();
      await writeFile(this.kanbanPath, JSON.stringify(board, null, 2), 'utf-8');
      this.json(res, 200, ticket);

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

    } else if (pathname.startsWith('/api/')) {
      this.json(res, 404, { error: 'Not found' });

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
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
