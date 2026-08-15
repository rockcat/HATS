// ── Calendar / Scheduled Meetings ─────────────────────────────────────────────

import { esc } from './utils.js';
import { state } from './state.js';

const MEETING_TYPE_LABEL = {
  standup:         'Standup',
  sprint_planning: 'Sprint Planning',
  retro:           'Retro',
  review:          'Review',
  ad_hoc:          'Ad Hoc',
};

let calMeetings = [];
let calView     = 'week';
let calOffset   = 0;

const CAL_START_HOUR = 7;
const CAL_END_HOUR   = 21;
const CAL_HOUR_PX    = 52;

// ── Data fetch ────────────────────────────────────────────────────────────────

export async function fetchCalendar() {
  try {
    calMeetings = await fetch('/api/scheduled-meetings').then(r => r.json());
  } catch { calMeetings = []; }
  renderCalendarView();
}

export function renderCalendar(meetings) {
  calMeetings = meetings ?? [];
  renderCalendarView();
}

// ── Navigation ────────────────────────────────────────────────────────────────

function renderCalendarView() {
  updateCalNav();
  if (calView === 'week')       renderWeekView();
  else if (calView === 'day')   renderDayView();
  else                          renderAgendaView();
}

function updateCalNav() {
  const el = document.getElementById('cal-period');
  if (!el) return;
  if (calView === 'agenda') { el.textContent = 'Upcoming'; return; }
  const { start, end } = calWeekRange(calOffset);
  if (calView === 'week') {
    const same = start.getMonth() === end.getMonth();
    const s = start.toLocaleString(undefined, { month: 'short', day: 'numeric' });
    const e = end.toLocaleString(undefined, { month: same ? undefined : 'short', day: 'numeric' });
    el.textContent = `${s} – ${e}`;
  } else {
    const day = new Date();
    day.setDate(day.getDate() + calOffset);
    el.textContent = day.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }
}

function calWeekRange(offset) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dow = today.getDay();
  const mon = new Date(today);
  mon.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1) + offset * 7);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return { start: mon, end: sun };
}

// ── Grid helpers ──────────────────────────────────────────────────────────────

function buildGridHTML(days) {
  const totalH = (CAL_END_HOUR - CAL_START_HOUR) * CAL_HOUR_PX;
  const today  = new Date();
  today.setHours(0, 0, 0, 0);

  const headCols = days.map(d => {
    const isToday = d.getTime() === today.getTime();
    const label   = d.toLocaleString(undefined, { weekday: 'short', day: 'numeric' });
    return `<div class="cal-head-cell${isToday ? ' today' : ''}">${esc(label)}</div>`;
  }).join('');

  let timeLabels = '';
  for (let h = CAL_START_HOUR; h <= CAL_END_HOUR; h++) {
    const top   = (h - CAL_START_HOUR) * CAL_HOUR_PX;
    const label = h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`;
    timeLabels += `<div class="cal-time-label" style="top:${top}px">${label}</div>`;
  }

  let hourLines = '';
  for (let h = CAL_START_HOUR; h <= CAL_END_HOUR; h++) {
    const top = (h - CAL_START_HOUR) * CAL_HOUR_PX;
    hourLines += `<div class="cal-hour-line" style="top:${top}px"></div>`;
  }

  const dayCols = days.map((d, i) => {
    const events = calMeetingsOnDay(d).map(m => buildEventHTML(m)).join('');
    return `<div class="cal-day-col" data-day="${i}" style="height:${totalH}px">${hourLines}${events}</div>`;
  }).join('');

  const numCols = days.length;
  return `<div class="cal-grid">
    <div class="cal-grid-head" style="display:grid;grid-template-columns:44px repeat(${numCols},1fr)">
      <div class="cal-head-gutter"></div>
      ${headCols}
    </div>
    <div class="cal-grid-body">
      <div class="cal-time-col" style="height:${totalH}px">${timeLabels}</div>
      <div class="cal-days" style="grid-template-columns:repeat(${numCols},1fr)">${dayCols}</div>
    </div>
  </div>`;
}

function buildEventHTML(m) {
  const when       = new Date(m.scheduledFor);
  const startMin   = (when.getHours() - CAL_START_HOUR) * 60 + when.getMinutes();
  const durationMin = 60;
  const top    = Math.max(0, (startMin / 60) * CAL_HOUR_PX);
  const height = Math.max(20, (durationMin / 60) * CAL_HOUR_PX - 2);
  const timeStr = when.toLocaleString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `<div class="cal-event cal-event--${m.status}" style="top:${top}px;height:${height}px"
    title="${esc(m.topic)}" onclick="showMeetingPopup('${m.id}')">
    <div class="cal-event-time">${esc(timeStr)}</div>
    <div class="cal-event-title">${esc(m.topic)}</div>
  </div>`;
}

function toLocalDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function calMeetingsOnDay(d) {
  const dayStr = toLocalDateStr(d);
  return calMeetings.filter(m => toLocalDateStr(new Date(m.scheduledFor)) === dayStr);
}

// ── Week view ─────────────────────────────────────────────────────────────────

function renderWeekView() {
  const { start } = calWeekRange(calOffset);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }
  const pane = document.getElementById('calendar-pane');
  if (!pane) return;
  pane.innerHTML = buildGridHTML(days);
  const scrollTop = Math.max(0, (new Date().getHours() - CAL_START_HOUR - 1) * CAL_HOUR_PX);
  pane.querySelector('.cal-grid-body')?.scrollTo(0, scrollTop);
}

// ── Day view ──────────────────────────────────────────────────────────────────

function renderDayView() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + calOffset);
  const pane = document.getElementById('calendar-pane');
  if (!pane) return;
  pane.innerHTML = buildGridHTML([d]);
  const scrollTop = Math.max(0, (new Date().getHours() - CAL_START_HOUR - 1) * CAL_HOUR_PX);
  pane.querySelector('.cal-grid-body')?.scrollTo(0, scrollTop);
}

// ── Agenda view ───────────────────────────────────────────────────────────────

function renderAgendaView() {
  const pane = document.getElementById('calendar-pane');
  if (!pane) return;
  const active = calMeetings.filter(m => m.status !== 'cancelled');
  if (active.length === 0) {
    pane.innerHTML = '<div class="cal-agenda"><div class="cal-empty">No scheduled meetings.</div></div>';
    return;
  }
  const sorted = [...calMeetings].sort((a, b) => new Date(a.scheduledFor) - new Date(b.scheduledFor));
  const today  = new Date(); today.setHours(0, 0, 0, 0);

  const groups = new Map();
  for (const m of sorted) {
    const key = m.scheduledFor.slice(0, 10);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }

  let html = '<div class="cal-agenda">';
  for (const [key, meetings] of groups) {
    const d = new Date(key + 'T00:00:00');
    const isToday    = d.getTime() === today.getTime();
    const isTomorrow = d.getTime() === today.getTime() + 86400000;
    let label;
    if (isToday) label = 'Today';
    else if (isTomorrow) label = 'Tomorrow';
    else label = d.toLocaleString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

    html += `<div class="cal-date-group">
      <div class="cal-date-header${isToday ? ' today' : ''}">${esc(label)}</div>`;
    for (const m of meetings) html += buildAgendaItemHTML(m);
    html += '</div>';
  }
  html += '</div>';
  pane.innerHTML = html;
}

function buildAgendaItemHTML(m) {
  const when    = new Date(m.scheduledFor);
  const timeStr = when.toLocaleString(undefined, { hour: 'numeric', minute: '2-digit' });
  const parts   = [m.facilitator, ...(m.participants || [])];
  const people  = [...new Set(parts)].join(', ');
  const actions = m.status === 'scheduled'
    ? `<div class="calendar-item-actions">
        <button class="calendar-item-btn" onclick="launchMeetingNow('${m.id}')">Launch now</button>
        <button class="calendar-item-btn calendar-item-btn--danger" onclick="cancelMeeting('${m.id}')">Cancel</button>
       </div>`
    : '';
  return `<div class="calendar-item calendar-item--${m.status}">
    <div class="calendar-item-header">
      <span class="calendar-item-time">${esc(timeStr)}</span>
      <span class="calendar-item-type">${esc(MEETING_TYPE_LABEL[m.type] ?? m.type)}</span>
      <span class="calendar-item-topic">${esc(m.topic)}</span>
    </div>
    <div class="calendar-item-meta">${esc(people)}</div>
    ${m.agenda ? `<div class="calendar-item-meta">${esc(m.agenda.slice(0, 100))}</div>` : ''}
    ${actions}
  </div>`;
}

// ── Meeting detail modal ──────────────────────────────────────────────────────

let _meetingDetailId = null;

function showMeetingPopup(id) {
  const m = calMeetings.find(x => x.id === id);
  if (!m) return;
  _meetingDetailId = id;

  const when   = m.scheduledFor
    ? new Date(m.scheduledFor).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : (m.startedAt ? new Date(m.startedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');
  const parts  = [m.facilitator, ...(m.participants || [])];
  const people = [...new Set(parts)].join(', ');

  document.getElementById('meeting-detail-topic').textContent   = m.topic;
  document.getElementById('meeting-detail-time').textContent    = when;
  document.getElementById('meeting-detail-people').textContent  = people;
  document.getElementById('meeting-detail-agenda').textContent  = m.agenda || '';
  document.getElementById('meeting-detail-agenda').hidden       = !m.agenda;
  document.getElementById('meeting-detail-status').textContent  = m.status;
  document.getElementById('meeting-detail-status').className    = `meeting-detail-status status-${m.status}`;

  document.getElementById('meeting-detail-launch-btn').hidden  = m.status !== 'scheduled';
  document.getElementById('meeting-detail-cancel-btn').hidden  = m.status !== 'scheduled';
  document.getElementById('meeting-detail-delete-btn').hidden  = m.status === 'scheduled';
  document.getElementById('meeting-detail-minutes-btn').hidden = !(m.status === 'launched' && m.meetingId);

  document.getElementById('meeting-detail-modal').hidden = false;
}

function closeMeetingDetail() {
  document.getElementById('meeting-detail-modal').hidden = true;
  _meetingDetailId = null;
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function launchMeetingNow(id) {
  try {
    const res = await fetch(`/api/scheduled-meetings/${id}/launch`, { method: 'POST' }).then(r => r.json());
    if (res.error) alert(res.error); else fetchCalendar();
  } catch { alert('Failed to launch meeting.'); }
}

async function cancelMeeting(id) {
  if (!confirm('Cancel this meeting?')) return;
  try {
    const res = await fetch(`/api/scheduled-meetings/${id}/cancel`, { method: 'POST' }).then(r => r.json());
    if (res.error) alert(res.error); else fetchCalendar();
  } catch { alert('Failed to cancel meeting.'); }
}

async function deleteMeeting(id) {
  try {
    const res = await fetch(`/api/scheduled-meetings/${id}`, { method: 'DELETE' }).then(r => r.json());
    if (res.error) alert(res.error); else fetchCalendar();
  } catch { alert('Failed to delete meeting.'); }
}

// Expose for inline onclick in rendered HTML
window.showMeetingPopup  = showMeetingPopup;
window.launchMeetingNow  = launchMeetingNow;
window.cancelMeeting     = cancelMeeting;

// ── Minutes modal ─────────────────────────────────────────────────────────────

async function openMinutes(meetingId, topic) {
  document.getElementById('minutes-modal-title').textContent   = `Minutes: ${topic}`;
  document.getElementById('minutes-modal-content').textContent = 'Loading…';
  document.getElementById('minutes-modal').hidden = false;
  try {
    const res  = await fetch(`/api/meetings/${encodeURIComponent(meetingId)}/minutes`);
    const data = await res.json();
    document.getElementById('minutes-modal-content').textContent = data.markdown ?? data.error ?? 'No content.';
  } catch {
    document.getElementById('minutes-modal-content').textContent = 'Failed to load minutes.';
  }
}

function closeMinutes() {
  document.getElementById('minutes-modal').hidden = true;
}

// ── initCalendar ──────────────────────────────────────────────────────────────

export function initCalendar() {
  document.querySelectorAll('.cal-view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      calView   = btn.dataset.view;
      calOffset = 0;
      document.querySelectorAll('.cal-view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === calView));
      document.getElementById('cal-nav').hidden = calView === 'agenda';
      renderCalendarView();
    });
  });

  document.getElementById('cal-prev')?.addEventListener('click', () => { calOffset--; renderCalendarView(); });
  document.getElementById('cal-next')?.addEventListener('click', () => { calOffset++; renderCalendarView(); });

  document.getElementById('new-meeting-btn')?.addEventListener('click', openNewMeeting);
  document.getElementById('new-meeting-close')?.addEventListener('click', closeNewMeeting);
  document.getElementById('new-meeting-cancel')?.addEventListener('click', closeNewMeeting);
  document.getElementById('new-meeting-save')?.addEventListener('click', saveNewMeeting);
  document.getElementById('new-meeting-modal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeNewMeeting();
  });

  document.getElementById('meeting-detail-close')?.addEventListener('click', closeMeetingDetail);
  document.getElementById('meeting-detail-modal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeMeetingDetail();
  });
  document.getElementById('meeting-detail-launch-btn')?.addEventListener('click', async () => {
    const id = _meetingDetailId; closeMeetingDetail(); await launchMeetingNow(id);
  });
  document.getElementById('meeting-detail-cancel-btn')?.addEventListener('click', async () => {
    const id = _meetingDetailId; closeMeetingDetail(); await cancelMeeting(id);
  });
  document.getElementById('meeting-detail-delete-btn')?.addEventListener('click', async () => {
    const id = _meetingDetailId; closeMeetingDetail(); await deleteMeeting(id);
  });
  document.getElementById('meeting-detail-minutes-btn')?.addEventListener('click', () => {
    const m = calMeetings.find(x => x.id === _meetingDetailId);
    if (m?.meetingId) openMinutes(m.meetingId, m.topic);
  });

  document.getElementById('minutes-modal-close')?.addEventListener('click', closeMinutes);
  document.getElementById('minutes-modal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeMinutes();
  });
}

function openNewMeeting() {
  const modal = document.getElementById('new-meeting-modal');
  const dt    = new Date(Date.now() + 3600_000);
  dt.setSeconds(0, 0);
  document.getElementById('meeting-datetime').value = dt.toISOString().slice(0, 16);
  document.getElementById('meeting-topic').value    = '';
  document.getElementById('meeting-agenda').value   = '';
  document.getElementById('new-meeting-error').textContent = '';

  const facSel = document.getElementById('meeting-facilitator');
  facSel.innerHTML = '';
  (state.agents || []).forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.name; opt.textContent = a.name;
    if (a.hatType === 'blue') opt.selected = true;
    facSel.appendChild(opt);
  });

  const grid = document.getElementById('meeting-participants');
  grid.innerHTML = '';
  [...(state.agents || []).map(a => a.name), 'human'].forEach(name => {
    const lbl = document.createElement('label');
    lbl.className = 'meeting-participant-label';
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.value = name;
    lbl.appendChild(cb); lbl.append(name);
    grid.appendChild(lbl);
  });

  modal.hidden = false;
  document.getElementById('meeting-topic').focus();
}

function closeNewMeeting() {
  document.getElementById('new-meeting-modal').hidden = true;
}

async function saveNewMeeting() {
  const errEl      = document.getElementById('new-meeting-error');
  errEl.textContent = '';
  const type        = document.getElementById('meeting-type').value;
  const facilitator = document.getElementById('meeting-facilitator').value;
  const topic       = document.getElementById('meeting-topic').value.trim();
  const agenda      = document.getElementById('meeting-agenda').value.trim();
  const datetimeVal = document.getElementById('meeting-datetime').value;
  const participants = [...document.querySelectorAll('#meeting-participants input:checked')].map(cb => cb.value);

  if (!topic)       { errEl.textContent = 'Topic is required.'; return; }
  if (!datetimeVal) { errEl.textContent = 'Date & time is required.'; return; }
  const scheduledFor = new Date(datetimeVal).toISOString();

  const btn = document.getElementById('new-meeting-save');
  btn.disabled = true; btn.textContent = 'Scheduling…';
  try {
    const res = await fetch('/api/scheduled-meetings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, facilitator, participants, topic, agenda: agenda || undefined, scheduledFor }),
    }).then(r => r.json());
    if (res.error) { errEl.textContent = res.error; }
    else { closeNewMeeting(); fetchCalendar(); }
  } catch { errEl.textContent = 'Failed to schedule meeting.'; }
  btn.disabled = false; btn.textContent = 'Schedule';
}

// ── Impromptu meeting ─────────────────────────────────────────────────────────

function openImpromptuMeeting() {
  document.getElementById('impromptu-topic').value    = '';
  document.getElementById('impromptu-agenda').value   = '';
  document.getElementById('impromptu-error').textContent = '';

  const facilitatorSel = document.getElementById('impromptu-facilitator');
  facilitatorSel.innerHTML = '';
  const agents = state.agents ?? [];
  const blue   = agents.filter(a => a.hatType === 'blue');
  const others = agents.filter(a => a.hatType !== 'blue');
  for (const a of [...blue, ...others]) {
    const opt = document.createElement('option');
    opt.value = a.name; opt.textContent = `${a.name} (${a.hatType})`;
    facilitatorSel.appendChild(opt);
  }

  const grid = document.getElementById('impromptu-participants');
  grid.innerHTML = '';
  [...agents.map(a => a.name), 'human'].forEach(name => {
    const lbl = document.createElement('label');
    lbl.className = 'meeting-participant-label';
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.value = name; cb.checked = true;
    lbl.appendChild(cb); lbl.append(' ' + name);
    grid.appendChild(lbl);
  });

  document.getElementById('impromptu-modal').hidden = false;
  document.getElementById('impromptu-topic').focus();
}

function closeImpromptuMeeting() {
  document.getElementById('impromptu-modal').hidden = true;
}

async function startImpromptuMeeting() {
  const errEl       = document.getElementById('impromptu-error');
  const topic       = document.getElementById('impromptu-topic').value.trim();
  const agenda      = document.getElementById('impromptu-agenda').value.trim();
  const facilitator = document.getElementById('impromptu-facilitator').value;
  const participants = [...document.querySelectorAll('#impromptu-participants input:checked')]
    .map(cb => cb.value).filter(n => n !== facilitator);
  errEl.textContent = '';

  if (!topic)      { errEl.textContent = 'Topic is required.'; return; }
  if (!facilitator){ errEl.textContent = 'At least one agent is needed to facilitate.'; return; }

  const btn = document.getElementById('impromptu-start');
  btn.disabled = true; btn.textContent = 'Starting…';

  try {
    const res = await fetch('/api/meetings/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, agenda: agenda || undefined, facilitator, participants }),
    }).then(r => r.json());
    if (res.error) { errEl.textContent = res.error; }
    else { closeImpromptuMeeting(); }
  } catch { errEl.textContent = 'Failed to start meeting.'; }

  btn.disabled = false; btn.textContent = 'Start Meeting';
}

export function initImpromptuMeeting() {
  document.getElementById('impromptu-meeting-btn').addEventListener('click', openImpromptuMeeting);
  document.getElementById('impromptu-close').addEventListener('click', closeImpromptuMeeting);
  document.getElementById('impromptu-cancel').addEventListener('click', closeImpromptuMeeting);
  document.getElementById('impromptu-start').addEventListener('click', startImpromptuMeeting);
  document.getElementById('impromptu-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeImpromptuMeeting();
  });
  document.getElementById('impromptu-topic').addEventListener('keydown', e => {
    if (e.key === 'Enter') startImpromptuMeeting();
  });
}
