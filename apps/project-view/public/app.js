// ── Looking at the work ───────────────────────────────────────────────────────
//
// Wiring only; the shaping is in board-model.js, which touches nothing.
//
// One rule runs through this app and distinguishes it from the dashboard: the
// runner being down is a normal condition, not an error. The board, the
// calendar, the files and the costs are all things somebody wants to read
// while the runner is being restarted — which, during development, is most of
// the time. So every panel loads independently, each failure is reported where
// it happened, and nothing takes the page down with it.

import { $, $$, clear, el, relativeTime, toastError, toastOk } from '/ui-kit/hats-ui.js';
import { COLUMN_LABELS, byAssignee, stale, summarise, toColumns } from '/board-model.js';

const API = '/runner/api';

const state = {
  board: null,
  meetings: [],
  requests: [],
  files: [],
  telemetry: null,
};

// ── Talking to the runner ────────────────────────────────────────────────────

async function get(path) {
  const response = await fetch(`${API}${path}`);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function send(method, path, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.status === 204 ? null : response.json().catch(() => null);
}

/**
 * Load one panel.
 *
 * Each panel says for itself when it could not load, rather than one failure
 * blanking the page. A runner mid-restart should cost you the board, not the
 * calendar you were reading.
 */
async function load(name, fetcher, render) {
  try {
    await fetcher();
    render();
  } catch (err) {
    renderProblem(name, err);
  }
}

function renderProblem(name, err) {
  const host = $(`#${name}-list`) ?? $(`#${name}-columns`);
  if (!host) return;
  clear(host);
  host.append(el('p', { class: 'muted empty' },
    `Could not load this from the runner (${err.message}).`,
    el('br'),
    'It may be restarting — everything else on this page still works.'));
}

// ── The board ────────────────────────────────────────────────────────────────

async function loadBoard() { state.board = await get('/kanban/tickets'); }

function renderBoard() {
  const counts = summarise(state.board);
  clear($('#board-summary'));
  $('#board-summary').append(
    stat(counts.open, 'open'),
    stat(counts.inProgress, 'in progress'),
    stat(counts.blocked, 'blocked', counts.blocked > 0 ? 'warn' : ''),
    stat(counts.closed, 'closed'),
  );

  // Stale work is the thing a board is read to find, so it is said out loud
  // rather than left to be spotted among everything else.
  const stuck = stale(state.board);
  const attention = $('#board-attention');
  attention.hidden = stuck.length === 0;
  clear(attention);
  if (stuck.length) {
    attention.append(el('strong', {}, `${stuck.length} not moved in days: `),
      ...stuck.slice(0, 5).map((t) => el('button', {
        class: 'link', onclick: () => openTicket(t),
      }, t.id)));
  }

  const columns = $('#board-columns');
  clear(columns);
  for (const { column, label, tickets } of toColumns(state.board)) {
    columns.append(el('div', { class: `column ${column}` },
      el('header', {}, label, el('span', { class: 'count' }, String(tickets.length))),
      ...(tickets.length
        ? tickets.map(ticketCard)
        : [el('p', { class: 'muted empty' }, 'Nothing here')]),
    ));
  }

  const workloads = byAssignee(state.board);
  if (workloads.length) {
    columns.append(el('div', { class: 'column who' },
      el('header', {}, 'Who is on what'),
      ...workloads.map(({ who, tickets }) => el('div', { class: 'who-row' },
        el('strong', {}, who),
        el('span', { class: 'muted' }, `${tickets.length} live`))),
    ));
  }
}

const ticketCard = (ticket) => el('button', {
  class: `card priority-${ticket.priority ?? 'medium'}`,
  onclick: () => openTicket(ticket),
},
  el('span', { class: 'card-id' }, ticket.id),
  el('span', { class: 'card-title' }, ticket.title ?? '(untitled)'),
  ...(ticket.assignee ? [el('span', { class: 'card-who' }, ticket.assignee)] : []),
);

const stat = (value, label, kind = '') => el('div', { class: `stat ${kind}` },
  el('strong', {}, String(value)), el('span', {}, label));

async function openTicket(ticket) {
  openDetail(`${ticket.id} — ${ticket.title ?? ''}`, [
    el('p', { class: 'row gap' },
      el('span', { class: `tag priority-${ticket.priority ?? 'medium'}` }, ticket.priority ?? 'medium'),
      el('span', { class: 'tag' }, COLUMN_LABELS[ticket.column] ?? ticket.column ?? 'backlog'),
      ...(ticket.assignee ? [el('span', { class: 'tag' }, ticket.assignee)] : []),
    ),
    ...(ticket.description ? [el('p', { class: 'wrap' }, ticket.description)] : []),
    el('h4', {}, 'Comments'),
    ...(ticket.comments?.length
      ? ticket.comments.map((c) => el('div', { class: 'comment' },
          el('span', { class: 'muted' }, `${c.author ?? 'someone'} · ${relativeTime(c.at ?? c.createdAt) ?? ''}`),
          el('p', { class: 'wrap' }, c.text ?? c.body ?? '')))
      : [el('p', { class: 'muted' }, 'None yet.')]),
    commentBox(ticket),
  ]);
}

/** The one thing this view writes. Reading a board and having nothing to say
 *  back is the common frustration with a read-only project page. */
function commentBox(ticket) {
  const input = el('input', { type: 'text', placeholder: 'Add a comment…' });
  const post = async () => {
    const text = input.value.trim();
    if (!text) return;
    try {
      await send('POST', `/kanban/tickets/${encodeURIComponent(ticket.id)}/comments`,
        { text, author: 'human' });
      input.value = '';
      toastOk('Comment added');
      await load('board', loadBoard, renderBoard);
    } catch (err) {
      toastError(err);
    }
  };

  input.addEventListener('keydown', (event) => { if (event.key === 'Enter') void post(); });
  return el('div', { class: 'row gap' }, input,
    el('button', { class: 'btn primary', onclick: post }, 'Add'));
}

// ── The calendar ─────────────────────────────────────────────────────────────

async function loadCalendar() { state.meetings = await get('/scheduled-meetings'); }

function renderCalendar() {
  const meetings = [...(state.meetings ?? [])]
    .sort((a, b) => String(a.scheduledFor ?? '').localeCompare(String(b.scheduledFor ?? '')));
  const now = Date.now();
  const upcoming = meetings.filter((m) => Date.parse(m.scheduledFor ?? '') >= now);

  clear($('#calendar-summary'));
  $('#calendar-summary').append(
    stat(upcoming.length, 'upcoming'),
    stat(meetings.length - upcoming.length, 'past'),
  );

  const list = $('#calendar-list');
  clear(list);
  if (meetings.length === 0) {
    list.append(el('p', { class: 'muted empty' }, 'Nothing scheduled.'));
    return;
  }

  for (const meeting of meetings) {
    const when = Date.parse(meeting.scheduledFor ?? '');
    const past = Number.isFinite(when) && when < now;
    list.append(el('div', { class: `row-item ${past ? 'past' : ''}` },
      el('div', { class: 'grow' },
        el('strong', {}, meeting.topic ?? 'Meeting'),
        el('span', { class: 'muted' },
          `${meeting.facilitator ?? 'someone'} · ${(meeting.participants ?? []).length} attending`
          + (Number.isFinite(when) ? ` · ${new Date(when).toLocaleString()}` : '')),
      ),
      ...(past ? [] : [el('button', {
        class: 'btn', onclick: () => launch(meeting),
      }, 'Start now')]),
    ));
  }
}

async function launch(meeting) {
  try {
    await send('POST', `/scheduled-meetings/${encodeURIComponent(meeting.id)}/launch`);
    toastOk('Meeting started');
  } catch (err) {
    toastError(new Error(`Could not start it: ${err.message}. The runner may be down.`));
  }
}

// ── Waiting on a person ──────────────────────────────────────────────────────

async function loadRequests() { state.requests = await get('/human-requests'); }

function renderRequests() {
  const open = (state.requests?.requests ?? state.requests ?? [])
    .filter((r) => !r.answeredAt && !r.dismissedAt);

  const pip = $('#requests-pip');
  pip.hidden = open.length === 0;
  pip.textContent = String(open.length);

  const list = $('#requests-list');
  clear(list);
  if (open.length === 0) {
    list.append(el('p', { class: 'muted empty' }, 'Nothing is waiting on you.'));
    return;
  }

  for (const request of open) {
    const input = el('input', { type: 'text', placeholder: 'Your answer…' });
    const respond = async () => {
      const text = input.value.trim();
      if (!text) return;
      try {
        await send('POST', `/human-requests/${encodeURIComponent(request.id)}/respond`, { response: text });
        toastOk('Sent');
        await load('requests', loadRequests, renderRequests);
      } catch (err) { toastError(err); }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') void respond(); });

    list.append(el('div', { class: 'row-item column-item' },
      el('div', {},
        el('strong', {}, request.agent ?? 'An agent'),
        el('span', { class: 'muted' }, ` asked ${relativeTime(request.askedAt ?? request.at) ?? ''}`)),
      el('p', { class: 'wrap' }, request.question ?? request.prompt ?? ''),
      el('div', { class: 'row gap' }, input,
        el('button', { class: 'btn primary', onclick: respond }, 'Answer')),
    ));
  }
}

// ── What the team produced ───────────────────────────────────────────────────

async function loadFiles() { state.files = await get('/project/files'); }

function renderFiles() {
  const files = state.files?.files ?? state.files ?? [];
  const list = $('#files-list');
  clear(list);

  if (files.length === 0) {
    list.append(el('p', { class: 'muted empty' }, 'No files yet.'));
    return;
  }

  for (const file of files) {
    const path = file.path ?? file.name ?? String(file);
    list.append(el('a', {
      class: 'row-item', href: `${API}/project/file?path=${encodeURIComponent(path)}`,
      target: '_blank', rel: 'noopener',
    },
      el('span', { class: 'grow' }, path),
      ...(file.size ? [el('span', { class: 'muted mono' }, formatSize(file.size))] : []),
    ));
  }
}

const formatSize = (bytes) => bytes < 1024 ? `${bytes} B`
  : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB`
  : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// ── What it has cost ─────────────────────────────────────────────────────────

async function loadCost() { state.telemetry = await get('/telemetry'); }

function renderCost() {
  const data = state.telemetry ?? {};
  const agents = data.agents ?? data.byAgent ?? [];

  clear($('#cost-summary'));
  $('#cost-summary').append(
    stat(money(data.totalCost ?? data.cost ?? 0), 'total'),
    stat(compact(data.totalTokens ?? data.tokens ?? 0), 'tokens'),
    stat(data.calls ?? agents.length ?? 0, 'calls'),
  );

  const list = $('#cost-list');
  clear(list);
  if (!agents.length) {
    list.append(el('p', { class: 'muted empty' }, 'Nothing recorded yet.'));
    return;
  }
  for (const agent of agents) {
    list.append(el('div', { class: 'row-item' },
      el('span', { class: 'grow' }, agent.name ?? agent.agent ?? 'unknown'),
      el('span', { class: 'muted mono' }, compact(agent.tokens ?? 0)),
      el('strong', { class: 'mono' }, money(agent.cost ?? 0)),
    ));
  }
}

const money = (n) => `$${Number(n ?? 0).toFixed(2)}`;
const compact = (n) => n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M`
  : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n ?? 0);

// ── The detail panel ─────────────────────────────────────────────────────────

function openDetail(title, body) {
  $('#detail-title').textContent = title;
  clear($('#detail-body'));
  $('#detail-body').append(...body);
  $('#detail').hidden = false;
}

$('#detail-close').addEventListener('click', () => { $('#detail').hidden = true; });
$('#detail').addEventListener('click', (event) => {
  if (event.target === $('#detail')) $('#detail').hidden = true;
});

// ── Tabs ─────────────────────────────────────────────────────────────────────

$('#tabs').addEventListener('click', (event) => {
  const tab = event.target.closest('.tab');
  if (!tab) return;
  for (const t of $$('.tab')) t.classList.toggle('active', t === tab);
  for (const view of $$('.view')) {
    view.classList.toggle('active', view.id === `view-${tab.dataset.view}`);
  }
});

// ── Staying current ──────────────────────────────────────────────────────────

/**
 * Follow the runner's event stream, and survive it going away.
 *
 * EventSource reconnects by itself, so the only job here is to say whether it
 * is connected and to reload the panel an event concerns.
 */
function follow() {
  const source = new EventSource(`${API}/events`);
  const dot = $('#runner-dot');

  source.addEventListener('open', () => {
    dot.classList.add('ok');
    $('#runner-label').textContent = 'runner';
  });
  source.addEventListener('error', () => {
    dot.classList.remove('ok');
    $('#runner-label').textContent = 'runner down';
  });

  const on = (type, fn) => source.addEventListener(type, () => void fn());
  on('kanban_update',            () => load('board', loadBoard, renderBoard));
  on('scheduled_meetings_update', () => load('calendar', loadCalendar, renderCalendar));
  on('requests_update',          () => load('requests', loadRequests, renderRequests));
  on('files_update',             () => load('files', loadFiles, renderFiles));
  on('telemetry_update',         () => load('cost', loadCost, renderCost));
}

// ── Start ────────────────────────────────────────────────────────────────────

(async function boot() {
  try {
    const project = await get('/project');
    $('#project-name').textContent = project.name ?? 'Project';
    $('#project-goal').textContent = project.goal ?? '';
  } catch {
    $('#project-goal').textContent = 'the runner is not answering';
  }

  // In parallel, and independently: one panel failing must not blank the rest.
  await Promise.all([
    load('board', loadBoard, renderBoard),
    load('calendar', loadCalendar, renderCalendar),
    load('requests', loadRequests, renderRequests),
    load('files', loadFiles, renderFiles),
    load('cost', loadCost, renderCost),
  ]);

  follow();
})();
