import * as http from 'node:http';
import * as fs   from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KanbanStore } from '../mcp/kanban/store.js';
import type { Ticket } from '../mcp/kanban/types.js';

export type { Ticket };

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.ico':  'image/x-icon',
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AgentStatus {
  name:      string;
  hatType:   string;
  state:     'idle' | 'working' | 'waiting_for_help' | 'in_discussion';
  activity:  string;
  talkingTo?: string;
}

// ── Server state ──────────────────────────────────────────────────────────────

const clients: http.ServerResponse[] = [];
let agents:  AgentStatus[] = [];
let tickets: Ticket[]      = [];

// ── Kanban store ──────────────────────────────────────────────────────────────

let kanbanStore: KanbanStore | null = null;
let watchDebounce: ReturnType<typeof setTimeout> | null = null;

async function loadKanban(filePath: string) {
  if (!kanbanStore) {
    kanbanStore = new KanbanStore(filePath);
    await kanbanStore.load();
  }
  tickets = kanbanStore.listTickets();
}

function watchKanban(filePath: string) {
  fs.watch(filePath, () => {
    // Debounce — the file may be written in multiple chunks
    if (watchDebounce) clearTimeout(watchDebounce);
    watchDebounce = setTimeout(async () => {
      // Re-create the store so it re-reads from disk
      kanbanStore = new KanbanStore(filePath);
      await kanbanStore.load();
      tickets = kanbanStore.listTickets();
      broadcast({ type: 'kanban_update', tickets });
    }, 150);
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export function setAgents(next: AgentStatus[]) {
  agents = next;
  broadcast({ type: 'agent_update', agents });
}

export function updateAgent(name: string, update: Partial<AgentStatus>) {
  const i = agents.findIndex(a => a.name === name);
  if (i >= 0) agents[i] = { ...agents[i], ...update };
  broadcast({ type: 'agent_update', agents });
}

// ── Broadcast ─────────────────────────────────────────────────────────────────

function broadcast(data: object) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (let i = clients.length - 1; i >= 0; i--) {
    try { clients[i].write(msg); }
    catch { clients.splice(i, 1); }
  }
}

// ── HTTP server ───────────────────────────────────────────────────────────────

export async function startWebUI(opts: {
  demo?: boolean;
  port?: number;
  kanbanPath?: string;
} = {}) {
  const port       = opts.port ?? parseInt(process.env.WEBUI_PORT ?? '3000');
  const kanbanPath = path.resolve(opts.kanbanPath ?? process.env.KANBAN_PATH ?? './kanban-board.json');

  // Load kanban data before starting the server
  await loadKanban(kanbanPath);
  watchKanban(kanbanPath);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url!, `http://localhost:${port}`);

    // SSE stream
    if (url.pathname === '/events') {
      res.writeHead(200, {
        'Content-Type':  'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection':    'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      res.write(`data: ${JSON.stringify({ type: 'init', agents, tickets })}\n\n`);
      clients.push(res);
      req.on('close', () => {
        const i = clients.indexOf(res);
        if (i >= 0) clients.splice(i, 1);
      });
      return;
    }

    // Push endpoint — orchestrator can POST agent state here
    if (url.pathname === '/push' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const payload = JSON.parse(body);
          if (payload.agents) { agents = payload.agents; broadcast({ type: 'agent_update', agents }); }
          res.writeHead(200); res.end('OK');
        } catch {
          res.writeHead(400); res.end('Bad JSON');
        }
      });
      return;
    }

    // Static files
    const rel      = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const filePath = path.join(PUBLIC_DIR, rel);

    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403); res.end('Forbidden');
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      const ct = MIME[path.extname(filePath)] ?? 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': ct });
      res.end(data);
    });
  });

  server.listen(port, () => {
    console.log(`\nWebUI → http://localhost:${port}\n`);
  });

  if (opts.demo) startDemo();

  return server;
}

// ── Demo ──────────────────────────────────────────────────────────────────────

function startDemo() {
  agents = [
    { name: 'Alice', hatType: 'white',  state: 'idle', activity: 'Ready for tasks' },
    { name: 'Bob',   hatType: 'red',    state: 'idle', activity: 'Ready for tasks' },
    { name: 'Carol', hatType: 'black',  state: 'idle', activity: 'Ready for tasks' },
    { name: 'Dave',  hatType: 'yellow', state: 'idle', activity: 'Ready for tasks' },
    { name: 'Eve',   hatType: 'green',  state: 'idle', activity: 'Ready for tasks' },
    { name: 'Frank', hatType: 'blue',   state: 'idle', activity: 'Ready for tasks' },
  ];

  const ACTIVITIES: Record<string, string[]> = {
    white:  ['Reviewing dataset from CRM export…', 'Cross-referencing figures against Q3…', 'Running statistical analysis…', 'Compiling factual summary…'],
    red:    ['This direction feels wrong to me.', 'Strong gut feeling — we should pivot.', 'Users will love this; intuition says go.', 'Something feels off about the proposal.'],
    black:  ['Identifying critical failure points…', 'Documenting worst-case scenarios…', 'This plan has three major risks.', 'Running vulnerability analysis…'],
    yellow: ['Seeing real potential here.', 'The upside could be substantial.', 'Mapping out best-case outcomes…', 'Aligns well with our growth targets.'],
    green:  ['What if we tried a completely different angle?', 'Sketching an unconventional approach…', 'Brainstorming 10 alternatives…', "Let's flip the problem on its head."],
    blue:   ['Coordinating team discussion…', 'Setting agenda for strategy meeting.', 'Checking in with all team members…', 'Summarising progress for the group.'],
  };

  let tick = 0;

  setInterval(() => {
    tick++;

    const updated = agents.map(a => ({ ...a }));

    if (tick % 3 === 0) {
      const idle = updated.filter(a => a.state === 'idle');
      if (idle.length > 0) {
        const a   = idle[Math.floor(Math.random() * idle.length)];
        const act = ACTIVITIES[a.hatType] ?? ['Working…'];
        a.state    = 'working';
        a.activity = act[Math.floor(Math.random() * act.length)];
        delete a.talkingTo;
      }
    }

    if (tick % 5 === 0) {
      const free = updated.filter(a => a.state === 'working' && !a.talkingTo);
      if (free.length >= 2) {
        const [a, b] = free;
        a.state = b.state = 'in_discussion';
        a.talkingTo = b.name;
        b.talkingTo = a.name;
        a.activity = `Discussing findings with ${b.name}…`;
        b.activity = `Consulting with ${a.name}…`;
      }
    }

    if (tick % 7 === 0) {
      for (const a of updated) {
        if (a.state === 'in_discussion') {
          a.state    = 'idle';
          a.activity = 'Ready for next task';
          delete a.talkingTo;
        }
      }
    }

    agents = updated;
    broadcast({ type: 'agent_update', agents });
  }, 2000);
}
