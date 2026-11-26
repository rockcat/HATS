// ── What an agent does on a timer ─────────────────────────────────────────────
//
// An agent's agenda holds two kinds of entry: copies of the global scheduled
// actions assigned to it, and things it scheduled for itself. Each can be
// switched off here without being lost. A copy's wording belongs to its global
// action — editing it opens that action, so every agent it is assigned to
// changes together — while the agent's own entries are edited in place.

import { esc, fmtAgo, fmtLastRun } from './utils.js';
import { openScheduleModal } from './schedules.js';
import { runNowButton, showRunOutcome } from './run-now.js';
import { repeatPicker, repeatText } from './repeat-picker.js';

function nextText(entry) {
  if (!entry.enabled) return 'off';
  const mins = Math.round((entry.nextRunAt - Date.now()) / 60_000);
  if (mins <= 0) return 'due now';
  if (mins < 60) return `next in ${mins} min`;
  const at = new Date(entry.nextRunAt);
  const time = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return at.toDateString() === new Date().toDateString()
    ? `next at ${time}`
    : `next ${at.toLocaleDateString([], { weekday: 'short' })} ${time}`;
}

async function patch(id, body) {
  const r = await fetch(`/api/agenda/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Save failed');
}

function editForm(entry, onDone) {
  const form = document.createElement('div');
  form.className = 'agenda-edit';
  form.innerHTML = `
    <input class="agenda-edit-label" value="${esc(entry.label)}" placeholder="Label">
    <textarea class="agenda-edit-desc" rows="2" placeholder="What to do — \${date} \${time} \${human} \${email} are filled in" title="\${date} \${time} \${human} and \${email} (the agent's) are filled in when it fires">${esc(entry.description)}</textarea>
    <div class="agenda-edit-repeat"></div>
    <div class="agenda-edit-btns">
      <button class="library-btn library-btn--add" data-act="save">Save</button>
      <button class="library-btn" data-act="cancel">Cancel</button>
    </div>`;
  const repeat = repeatPicker();
  repeat.set(entry);
  form.querySelector('.agenda-edit-repeat').appendChild(repeat.el);
  form.querySelector('[data-act="cancel"]').addEventListener('click', () => onDone(false));
  form.querySelector('[data-act="save"]').addEventListener('click', async () => {
    try {
      const { intervalMinutes, cron } = repeat.read();
      await patch(entry.id, {
        label: form.querySelector('.agenda-edit-label').value.trim() || entry.label,
        description: form.querySelector('.agenda-edit-desc').value.trim(),
        intervalSeconds: intervalMinutes ? Math.round(intervalMinutes * 60) : null,
        cron,
      });
      onDone(true);
    } catch (err) { alert(err.message); }
  });
  return form;
}

function entryRow(entry, action, reload) {
  const row = document.createElement('div');
  row.className = 'schedules-row agenda-row' + (entry.enabled ? '' : ' agenda-row--off');

  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.checked = entry.enabled;
  toggle.title = entry.enabled ? 'On — click to pause' : 'Paused — click to turn on';
  toggle.addEventListener('change', async () => {
    try { await patch(entry.id, { enabled: toggle.checked }); } catch (err) { alert(err.message); }
    reload();
  });

  const body = document.createElement('div');
  body.className = 'schedules-row-body';
  body.innerHTML = `
    <div class="schedules-row-label">${esc(entry.label)}${action ? ' <span class="schedules-mcp-badge" title="Assigned from a global scheduled action">global</span>' : ''}</div>
    <div class="schedules-row-desc">${esc(entry.description)}</div>`;

  const when = document.createElement('span');
  when.className = 'schedules-row-interval';
  when.textContent = `${repeatText(entry)} · ${nextText(entry)} · ${fmtLastRun(entry.lastRunAt)}`;
  if (entry.lastRunAt) when.title = `Last run ${new Date(entry.lastRunAt).toLocaleString()}`;

  // The latest attempt failed (a success clears lastError).
  if (entry.lastError) {
    const failed = document.createElement('div');
    failed.className = 'agenda-row-error';
    failed.textContent = `⚠ Failed ${fmtAgo(entry.lastErrorAt)}: ${entry.lastError}`;
    failed.title = `${entry.failures ?? 1} failed attempt(s) in a row`;
    body.appendChild(failed);
  }

  const edit = document.createElement('button');
  edit.className = 'library-btn';
  edit.textContent = 'Edit';
  edit.title = action ? 'Edit the global action — changes every agent it is assigned to' : 'Edit';
  edit.addEventListener('click', () => {
    if (action) { openScheduleModal(action); return; }
    row.replaceWith(editForm(entry, () => reload()));
  });

  const del = document.createElement('button');
  del.className = 'library-btn library-btn--del';
  del.textContent = '✕';
  del.title = action ? 'Remove from this agent in this project' : 'Delete';
  del.addEventListener('click', async () => {
    if (!confirm(`Remove "${entry.label}" from this agent?`)) return;
    await fetch(`/api/agenda/${encodeURIComponent(entry.id)}`, { method: 'DELETE' }).catch(() => {});
    reload();
  });

  const actions = document.createElement('div');
  actions.className = 'schedules-row-actions';
  // Not reloaded after: the outcome is shown in this row, and a reload would wipe it.
  const run = runNowButton(`/api/agenda/${encodeURIComponent(entry.id)}/run`, (text, failed) => showRunOutcome(body, text, failed));
  actions.append(run, edit, del);

  row.append(toggle, body, when, actions);
  return row;
}

/**
 * Assign another global action to this agent, in this project only — the
 * library template's own assignments are where a new copy starts, not a link.
 */
function assignPicker(name, entries, actions, reload) {
  const assigned = entries.flatMap(e => e.actionId ? [e.actionId] : []);
  const free = actions.filter(a => !assigned.includes(a.id));
  if (!free.length) return null;
  const sel = document.createElement('select');
  sel.className = 'agenda-assign';
  sel.innerHTML = '<option value="">+ Assign a scheduled action…</option>'
    + free.map(a => `<option value="${esc(a.id)}">${esc(a.label)}</option>`).join('');
  sel.addEventListener('change', async () => {
    if (!sel.value) return;
    sel.disabled = true;
    await fetch(`/api/agents/${encodeURIComponent(name)}/scheduled-actions`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduledActionIds: [...assigned, sel.value] }),
    }).catch(() => {});
    reload();
  });
  return sel;
}

async function loadAgenda(name, el) {
  el.innerHTML = '<p class="memory-empty">Loading…</p>';
  try {
    const [entries, actions] = await Promise.all([
      fetch(`/api/agenda?agent=${encodeURIComponent(name)}`).then(r => r.json()),
      fetch('/api/scheduled-actions').then(r => r.json()).catch(() => []),
    ]);
    const byId = new Map(actions.map(a => [a.id, a]));
    const reload = () => loadAgenda(name, el);
    el.innerHTML = entries.length ? '' : `<p class="memory-empty">${esc(name)} has nothing scheduled.</p>`;
    for (const e of entries) el.appendChild(entryRow(e, e.actionId ? byId.get(e.actionId) : undefined, reload));
    const picker = assignPicker(name, entries, actions, reload);
    if (picker) el.appendChild(picker);
  } catch {
    el.innerHTML = '<p class="memory-empty">Failed to load.</p>';
  }
}

/** Wire the schedule section for this agent; loaded when opened. */
export function bindAgentAgenda(name) {
  const panel = document.getElementById('agent-agenda-line');
  const body  = document.getElementById('agent-agenda');
  if (!panel || !body) return;
  panel.open = false;
  body.innerHTML = '';
  panel.ontoggle = () => { if (panel.open) loadAgenda(name, body); };
}
