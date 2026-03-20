import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFile } from 'fs/promises';
import { WebSocketServer, WebSocket } from 'ws';
import { TeamOrchestrator } from '../orchestrator/orchestrator.js';
import { StoredEvent } from '../store/event-store.js';
import { Board } from '../mcp/kanban/types.js';

export interface APIServerConfig {
  port?: number;          // default 3001
  kanbanPath?: string;    // path to kanban-board.json; omit to disable kanban endpoints
}

export class APIServer {
  private server;
  private wss: WebSocketServer;
  private orchestrator: TeamOrchestrator;
  private kanbanPath: string | null;
  private port: number;
  private unsubscribeEvents: (() => void) | null = null;

  constructor(orchestrator: TeamOrchestrator, config: APIServerConfig = {}) {
    this.orchestrator = orchestrator;
    this.kanbanPath = config.kanbanPath ?? null;
    this.port = config.port ?? 3001;

    this.server = createServer((req, res) => this.handleRequest(req, res));
    this.wss = new WebSocketServer({ server: this.server });
    this.wss.on('connection', (ws) => this.handleConnection(ws));
  }

  start(): void {
    // Subscribe to orchestrator events and broadcast to WebSocket clients
    this.unsubscribeEvents = this.orchestrator.onEvent((event) => {
      this.broadcast(event);
    });

    this.server.listen(this.port, () => {
      console.log(`[API] HTTP  http://localhost:${this.port}/api`);
      console.log(`[API] WS    ws://localhost:${this.port}/ws`);
    });
  }

  stop(): void {
    this.unsubscribeEvents?.();
    this.wss.close();
    this.server.close();
  }

  // ── WebSocket ─────────────────────────────────────────────────────────────

  private handleConnection(ws: WebSocket): void {
    // Send current snapshot on connect
    const snapshot = this.buildTeamSnapshot();
    ws.send(JSON.stringify({ type: 'snapshot', data: snapshot }));

    ws.on('error', () => {}); // suppress unhandled error crashes
  }

  private broadcast(event: StoredEvent): void {
    const msg = JSON.stringify({ type: 'event', data: event });
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }

  // ── HTTP routing ──────────────────────────────────────────────────────────

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // CORS headers so a browser UI on a different port can connect
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method !== 'GET') { this.send(res, 405, { error: 'Method not allowed' }); return; }

    const url = new URL(req.url ?? '/', `http://localhost:${this.port}`);
    const pathname = url.pathname;

    try {
      if (pathname === '/api/team') {
        this.send(res, 200, this.buildTeamSnapshot());

      } else if (pathname === '/api/tasks') {
        this.send(res, 200, this.orchestrator.listTasks());

      } else if (pathname === '/api/meetings') {
        this.send(res, 200, this.orchestrator.listMeetings());

      } else if (pathname === '/api/events') {
        const limit = parseInt(url.searchParams.get('limit') ?? '100', 10);
        const since = url.searchParams.get('since') ?? undefined;
        const events = await this.orchestrator.readEvents(since);
        this.send(res, 200, events.slice(-limit));

      } else if (pathname === '/api/kanban') {
        if (!this.kanbanPath) { this.send(res, 404, { error: 'Kanban not configured' }); return; }
        const includeBacklog = url.searchParams.get('includeBacklog') === 'true';
        const board = await this.readKanban();
        const summary = buildBoardSummary(board, includeBacklog);
        this.send(res, 200, summary);

      } else if (pathname === '/api/kanban/tickets') {
        if (!this.kanbanPath) { this.send(res, 404, { error: 'Kanban not configured' }); return; }
        const board = await this.readKanban();
        const column = url.searchParams.get('column') ?? undefined;
        const assignee = url.searchParams.get('assignee') ?? undefined;
        let tickets = Object.values(board.tickets);
        if (column) tickets = tickets.filter((t) => t.column === column);
        if (assignee) tickets = tickets.filter((t) => t.assignee === assignee);
        this.send(res, 200, tickets);

      } else if (pathname.startsWith('/api/kanban/tickets/')) {
        if (!this.kanbanPath) { this.send(res, 404, { error: 'Kanban not configured' }); return; }
        const id = pathname.replace('/api/kanban/tickets/', '');
        const board = await this.readKanban();
        const ticket = board.tickets[id];
        if (!ticket) { this.send(res, 404, { error: `Ticket "${id}" not found` }); return; }
        this.send(res, 200, ticket);

      } else {
        this.send(res, 404, { error: 'Not found' });
      }
    } catch (err) {
      console.error('[API] Error:', err);
      this.send(res, 500, { error: (err as Error).message });
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private buildTeamSnapshot() {
    return {
      agents: this.orchestrator.listAgents().map((a) => ({
        id: a.id,
        name: a.name,
        hatType: a.hatType,
        state: a.state,
        specialisation: a.config.identity.specialisation,
        model: a.config.model,
        provider: a.config.provider.name,
        historyLength: a.getHistory().length,
      })),
      tasks: this.orchestrator.listTasks(),
      meetings: this.orchestrator.listMeetings(),
    };
  }

  private async readKanban(): Promise<Board> {
    const raw = await readFile(this.kanbanPath!, 'utf-8');
    return JSON.parse(raw) as Board;
  }

  private send(res: ServerResponse, status: number, body: unknown): void {
    const json = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(json);
  }
}

// ── Kanban helpers ────────────────────────────────────────────────────────────

type Priority = 'low' | 'medium' | 'high' | 'critical';
type Column = 'backlog' | 'ready' | 'in_progress' | 'blocked' | 'completed';

function buildBoardSummary(board: Board, includeBacklog: boolean) {
  const columns: Column[] = includeBacklog
    ? ['backlog', 'ready', 'in_progress', 'blocked', 'completed']
    : ['ready', 'in_progress', 'blocked', 'completed'];

  const pri: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

  const result: Record<string, { count: number; tickets: unknown[] }> = {};
  for (const col of columns) {
    const tickets = Object.values(board.tickets)
      .filter((t) => t.column === col)
      .sort((a, b) => (pri[a.priority as Priority] - pri[b.priority as Priority]) || a.createdAt.localeCompare(b.createdAt))
      .map((t) => ({ id: t.id, title: t.title, priority: t.priority, assignee: t.assignee, tags: t.tags, updatedAt: t.updatedAt }));
    result[col] = { count: tickets.length, tickets };
  }
  return result;
}
