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
import {
  DAY_START_HOUR, MEETING_TYPES, TYPE_LABELS, agenda, daysInView, defaultMeetingTime,
  hourRows, meetingsOn, outsideHours, placeInDay, startOfDay, step, titleFor, whenOf,
} from '/calendar-model.js';

const API = '/runner/api';

const state = {
  board: null,
  meetings: [],
  requests: [],
  files: [],
  telemetry: null,
  agents: [],
  calView: 'week',
  calFocus: new Date(),
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

async function loadCalendar() {
  state.meetings = await get('/scheduled-meetings');
  // Best effort: without it the new-meeting form has nobody to offer, but the
  // calendar itself still reads fine.
  try {
    const roster = await get('/agents');
    state.agents = (roster.agents ?? roster ?? []).filter((a) => a?.name);
  } catch { /* leave whatever we had */ }
}

function renderCalendar() {
  const meetings = state.meetings ?? [];
  const { upcoming, past } = agenda(meetings);

  $('#cal-title').textContent = titleFor(state.calView, state.calFocus);
  $('#cal-date').value = toDateInput(state.calFocus);
  for (const chip of $$('#cal-views .chip')) {
    chip.classList.toggle('active', chip.dataset.cal === state.calView);
  }

  clear($('#calendar-summary'));
  $('#calendar-summary').append(
    stat(upcoming.length, 'upcoming'),
    stat(past.length, 'past'),
  );

  const grid = $('#calendar-grid');
  const list = $('#calendar-list');
  clear(grid);
  clear(list);

  if (state.calView === 'agenda') {
    grid.hidden = true;
    renderAgendaList(list, upcoming, past);
    return;
  }

  grid.hidden = false;
  renderGrid(grid, list, meetings);
}

function renderAgendaList(list, upcoming, past) {
  if (!upcoming.length && !past.length) {
    list.append(el('p', { class: 'muted empty' }, 'Nothing scheduled.'));
    return;
  }
  if (upcoming.length) {
    list.append(el('h4', { class: 'block-title' }, 'Coming up'),
      ...upcoming.map((m) => meetingRow(m, false)));
  }
  if (past.length) {
    list.append(el('h4', { class: 'block-title' }, 'Already happened'),
      ...past.slice(0, 30).map((m) => meetingRow(m, true)));
  }
}

/** A day or week drawn as hours, so a gap in the diary looks like a gap. */
function renderGrid(grid, list, meetings) {
  const days = daysInView(state.calView, state.calFocus);
  const today = startOfDay(new Date()).getTime();

  grid.style.setProperty('--days', String(days.length));
  grid.append(el('div', { class: 'cal-corner' }),
    ...days.map((day) => el('div', {
      class: `cal-dayhead ${day.getTime() === today ? 'today' : ''}`,
    },
      el('span', {}, day.toLocaleDateString(undefined, { weekday: 'short' })),
      el('strong', {}, String(day.getDate())),
    )));

  grid.append(el('div', { class: 'cal-hours' },
    ...hourRows().map((h) => el('div', { class: 'cal-hour' }, `${pad2(h)}:00`))));

  for (const day of days) {
    const column = el('div', { class: 'cal-day' },
      ...hourRows().map(() => el('div', { class: 'cal-slot' })));

    for (const meeting of meetingsOn(meetings, day)) {
      const place = placeInDay(meeting);
      if (!place) continue;
      const when = whenOf(meeting);
      column.append(el('button', {
        class: `cal-event type-${meeting.type ?? 'ad_hoc'}`,
        style: `top:${place.top * 100}%;height:${Math.max(place.height * 100, 4)}%`,
        onclick: () => openMeeting(meeting),
      },
        el('span', { class: 'cal-event-time' }, `${pad2(when.getHours())}:${pad2(when.getMinutes())}`),
        el('span', { class: 'cal-event-topic' }, meeting.topic ?? 'Meeting'),
      ));
    }
    grid.append(column);
  }

  // Anything outside the drawn hours is listed rather than hidden — a 03:00
  // meeting that simply vanished would be worse than an ugly footnote.
  const stragglers = days.flatMap((day) => outsideHours(meetings, day));
  if (stragglers.length) {
    list.append(el('h4', { class: 'block-title' }, 'Outside the shown hours'),
      ...stragglers.map((m) => meetingRow(m, false)));
  }
}

function meetingRow(meeting, past) {
  const when = whenOf(meeting);
  return el('div', { class: `row-item ${past ? 'past' : ''}` },
    el('div', { class: 'grow' },
      el('strong', {}, meeting.topic ?? 'Meeting'),
      el('span', { class: 'muted' },
        `${TYPE_LABELS[meeting.type] ?? 'Meeting'} · ${meeting.facilitator ?? 'someone'}`
        + ` · ${(meeting.participants ?? []).length} attending`
        + (when ? ` · ${when.toLocaleString()}` : ' · no date')),
    ),
    ...(past ? [] : [el('button', { class: 'btn', onclick: () => launch(meeting) }, 'Start now')]),
  );
}

function openMeeting(meeting) {
  const when = whenOf(meeting);
  openDetail(meeting.topic ?? 'Meeting', [
    el('p', { class: 'row gap' },
      el('span', { class: 'tag' }, TYPE_LABELS[meeting.type] ?? 'Meeting'),
      el('span', { class: 'tag' }, meeting.facilitator ?? 'someone'),
      ...(when ? [el('span', { class: 'tag' }, when.toLocaleString())] : []),
    ),
    ...(meeting.agenda ? [el('p', { class: 'wrap' }, meeting.agenda)] : []),
    el('h4', {}, 'Attending'),
    el('p', { class: 'wrap' }, (meeting.participants ?? []).join(', ') || 'Nobody listed'),
    el('div', { class: 'row gap' },
      el('button', { class: 'btn primary', onclick: () => launch(meeting) }, 'Start now'),
      el('button', { class: 'btn', onclick: () => cancelMeeting(meeting) }, 'Cancel it'),
    ),
  ]);
}

async function cancelMeeting(meeting) {
  try {
    await send('POST', `/scheduled-meetings/${encodeURIComponent(meeting.id)}/cancel`);
    toastOk('Cancelled');
    $('#detail').hidden = true;
    await load('calendar', loadCalendar, renderCalendar);
  } catch (err) { toastError(err); }
}

/** Book something. The runner needs a type, a facilitator and a time. */
function openNewMeeting() {
  const topic = el('input', { type: 'text', placeholder: 'What is it about?' });
  const when = el('input', { type: 'datetime-local', value: defaultMeetingTime() });
  const type = el('select', {},
    ...MEETING_TYPES.map((t) => el('option', { value: t.id }, t.label)));
  const agendaText = el('textarea', { rows: '3', placeholder: 'Agenda (optional)' });

  // Whoever is on the team. Without a facilitator the runner refuses, so this
  // is a list rather than a free-text box to get wrong.
  const facilitator = el('select', {},
    ...state.agents.map((a) => el('option', { value: a.name }, a.name)));
  const attending = state.agents.map((a) => ({
    name: a.name,
    box: el('input', { type: 'checkbox', checked: true }),
  }));

  const create = async () => {
    if (!topic.value.trim()) { toastError(new Error('It needs a topic.')); return; }
    try {
      await send('POST', '/scheduled-meetings', {
        type: type.value,
        topic: topic.value.trim(),
        agenda: agendaText.value.trim(),
        facilitator: facilitator.value,
        participants: attending.filter((a) => a.box.checked && a.name !== facilitator.value)
          .map((a) => a.name),
        scheduledFor: new Date(when.value).toISOString(),
      });
      toastOk('Meeting booked');
      $('#detail').hidden = true;
      await load('calendar', loadCalendar, renderCalendar);
    } catch (err) { toastError(err); }
  };

  openDetail('New meeting', [
    field('Topic', topic),
    field('Type', type),
    field('When', when),
    field('Led by', facilitator),
    field('Attending', el('div', { class: 'checks' },
      ...attending.map((a) => el('label', { class: 'check' }, a.box, a.name)))),
    field('Agenda', agendaText),
    el('div', { class: 'row gap' },
      el('button', { class: 'btn primary', onclick: create }, 'Book it'),
      el('button', { class: 'btn', onclick: () => { $('#detail').hidden = true; } }, 'Cancel'),
    ),
  ]);
}

const field = (label, control) =>
  el('label', { class: 'field' }, el('span', { class: 'field-label' }, label), control);

const toDateInput = (date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

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
  // The runner's shape: { id, agentName, message, urgency, status, createdAt }.
  // This read `agent` and `question` and filtered on timestamps that do not
  // exist, so every request rendered blank and none was ever filtered out.
  const open = (state.requests?.requests ?? state.requests ?? [])
    .filter((r) => (r.status ?? 'pending') === 'pending');

  const pip = $('#requests-pip');
  pip.hidden = open.length === 0;
  pip.textContent = String(open.length);

  const list = $('#requests-list');
  clear(list);
  if (open.length === 0) {
    list.append(el('p', { class: 'muted empty' }, 'Nothing is waiting on you.'));
    return;
  }

  // Most urgent first, then oldest: a request from June is more overdue than
  // one from this morning, and urgency is what decides which to read.
  const rank = { critical: 0, high: 1, medium: 2, low: 3 };
  open.sort((a, b) =>
    (rank[a.urgency] ?? 2) - (rank[b.urgency] ?? 2)
    || String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));

  for (const request of open.slice(0, 50)) {
    const input = el('input', { type: 'text', placeholder: 'Your answer…' });

    const act = async (what, body) => {
      try {
        await send('POST', `/human-requests/${encodeURIComponent(request.id)}/${what}`, body);
        toastOk(what === 'respond' ? 'Answer sent' : 'Dismissed');
        await load('requests', loadRequests, renderRequests);
      } catch (err) { toastError(err); }
    };

    const respond = () => {
      const text = input.value.trim();
      if (text) void act('respond', { response: text });
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') respond(); });

    list.append(el('div', { class: 'row-item column-item' },
      el('div', { class: 'row gap' },
        el('strong', {}, request.agentName ?? 'An agent'),
        el('span', { class: `tag urgency-${request.urgency ?? 'medium'}` }, request.urgency ?? 'medium'),
        el('span', { class: 'muted' }, relativeTime(request.createdAt) ?? ''),
      ),
      el('p', { class: 'wrap' }, request.message ?? ''),
      el('div', { class: 'row gap' }, input,
        el('button', { class: 'btn primary', onclick: respond }, 'Answer'),
        // Not every question still needs answering months later, and without
        // this there was no way to clear one.
        el('button', { class: 'btn', onclick: () => void act('dismiss') }, 'Dismiss'),
      ),
    ));
  }

  if (open.length > 50) {
    list.append(el('p', { class: 'muted empty' },
      `…and ${open.length - 50} more. Answer or dismiss these first.`));
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
  // Everything is under `summary`, and byAgent/byModel are objects keyed by
  // name rather than arrays. Reading the top level found nothing, so the
  // panel showed zeroes while the project had spent real money.
  const summary = state.telemetry?.summary ?? {};
  const tokens = (summary.totalInputTokens ?? 0) + (summary.totalOutputTokens ?? 0);

  clear($('#cost-summary'));
  $('#cost-summary').append(
    stat(money(summary.totalCost), 'total'),
    stat(compact(tokens), 'tokens'),
    stat(compact(summary.totalCalls ?? 0), 'calls'),
  );

  const list = $('#cost-list');
  clear(list);
  const rows = [
    ...breakdown(summary.byAgent, 'Agents'),
    ...breakdown(summary.byModel, 'Models'),
  ];
  if (!rows.length) {
    list.append(el('p', { class: 'muted empty' }, 'Nothing recorded yet.'));
    return;
  }
  list.append(...rows);
}

/** One titled block of name → cost rows, dearest first. */
function breakdown(byName, title) {
  const entries = Object.entries(byName ?? {});
  if (!entries.length) return [];

  entries.sort((a, b) => (b[1]?.cost ?? 0) - (a[1]?.cost ?? 0));
  return [
    el('h4', { class: 'block-title' }, title),
    ...entries.map(([name, usage]) => el('div', { class: 'row-item' },
      el('span', { class: 'grow' }, name),
      el('span', { class: 'muted mono' },
        compact((usage.inputTokens ?? 0) + (usage.outputTokens ?? 0))),
      el('strong', { class: 'mono' }, money(usage.cost)),
    )),
  ];
}

const money = (n) => `$${Number(n ?? 0).toFixed(2)}`;
const pad2 = (n) => String(n).padStart(2, '0');
const compact = (n) => n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M`
  : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n ?? 0);

// ── The detail panel ─────────────────────────────────────────────────────────

function openDetail(title, body) {
  $('#detail-title').textContent = title;
  clear($('#detail-body'));
  $('#detail-body').append(...body);
  $('#detail').hidden = false;
}

$('#cal-views').addEventListener('click', (event) => {
  const chip = event.target.closest('.chip');
  if (!chip) return;
  state.calView = chip.dataset.cal;
  renderCalendar();
});

$('#cal-prev').addEventListener('click', () => {
  state.calFocus = step(state.calView, state.calFocus, -1);
  renderCalendar();
});
$('#cal-next').addEventListener('click', () => {
  state.calFocus = step(state.calView, state.calFocus, 1);
  renderCalendar();
});
$('#cal-today').addEventListener('click', () => {
  state.calFocus = new Date();
  renderCalendar();
});
$('#cal-date').addEventListener('change', (event) => {
  const picked = new Date(`${event.target.value}T12:00`);
  if (!Number.isNaN(picked.getTime())) { state.calFocus = picked; renderCalendar(); }
});
$('#cal-add').addEventListener('click', openNewMeeting);

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
  // /events, not /api/events. The latter exists and answers 200 with JSON, so
  // EventSource opened it, failed to parse a stream, and reported the runner
  // as down while it was serving perfectly well.
  const source = new EventSource('/runner/events');
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
