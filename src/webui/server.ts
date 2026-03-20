import * as http from 'node:http';
import * as fs   from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

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

export interface TaskItem {
  id:          string;
  description: string;
  assignedTo:  string;
  status:      'pending' | 'active' | 'complete' | 'blocked';
}

// ── Server state ──────────────────────────────────────────────────────────────

const clients: http.ServerResponse[] = [];
let agents: AgentStatus[] = [];
let tasks:  TaskItem[]    = [];

// ── Public API ────────────────────────────────────────────────────────────────

export function setAgents(next: AgentStatus[]) {
  agents = next;
  broadcast({ type: 'agent_update', agents });
}

export function setTasks(next: TaskItem[]) {
  tasks = next;
  broadcast({ type: 'task_update', tasks });
}

export function updateAgent(name: string, update: Partial<AgentStatus>) {
  const i = agents.findIndex(a => a.name === name);
  if (i >= 0) agents[i] = { ...agents[i], ...update };
  broadcast({ type: 'agent_update', agents });
}

export function updateTask(task: TaskItem) {
  const i = tasks.findIndex(t => t.id === task.id);
  if (i >= 0) tasks[i] = task;
  else tasks.push(task);
  broadcast({ type: 'task_update', tasks });
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

export function startWebUI(opts: { demo?: boolean; port?: number } = {}) {
  const port = opts.port ?? parseInt(process.env.WEBUI_PORT ?? '3000');

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
      res.write(`data: ${JSON.stringify({ type: 'init', agents, tasks })}\n\n`);
      clients.push(res);
      req.on('close', () => {
        const i = clients.indexOf(res);
        if (i >= 0) clients.splice(i, 1);
      });
      return;
    }

    // Push endpoint — orchestrator can POST full state here
    if (url.pathname === '/push' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const payload = JSON.parse(body);
          if (payload.agents) agents = payload.agents;
          if (payload.tasks)  tasks  = payload.tasks;
          broadcast({ type: 'full_update', agents, tasks });
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

    // Basic path traversal guard
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

  tasks = [
    { id: 't1', description: 'Analyse Q4 market data and prepare report',   assignedTo: 'Alice', status: 'active'  },
    { id: 't2', description: 'Design new onboarding user flow',              assignedTo: 'Eve',   status: 'active'  },
    { id: 't3', description: 'Risk assessment for v2.0 feature set',        assignedTo: 'Carol', status: 'active'  },
    { id: 't4', description: 'Identify APAC expansion opportunities',       assignedTo: 'Dave',  status: 'pending' },
    { id: 't5', description: 'Sprint planning: performance optimisation',   assignedTo: 'Frank', status: 'pending' },
    { id: 't6', description: 'Update API documentation',                    assignedTo: 'Alice', status: 'pending' },
    { id: 't7', description: 'User sentiment analysis from support tickets', assignedTo: 'Bob',   status: 'pending' },
    { id: 't8', description: 'Brainstorm monetisation strategies',          assignedTo: 'Eve',   status: 'pending' },
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

    // Some idle agents start working
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

    // Two working agents start a discussion
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

    // End discussions → back to idle
    if (tick % 7 === 0) {
      for (const a of updated) {
        if (a.state === 'in_discussion') {
          a.state    = 'idle';
          a.activity = 'Ready for next task';
          delete a.talkingTo;
        }
      }
    }

    // Occasionally complete a task and promote one from backlog
    if (tick % 11 === 0) {
      const ai = tasks.findIndex(t => t.status === 'active');
      if (ai >= 0) tasks[ai] = { ...tasks[ai], status: 'complete' };
      const pi = tasks.findIndex(t => t.status === 'pending');
      if (pi >= 0) tasks[pi] = { ...tasks[pi], status: 'active' };
      broadcast({ type: 'task_update', tasks });
    }

    agents = updated;
    broadcast({ type: 'agent_update', agents });
  }, 2000);
}
