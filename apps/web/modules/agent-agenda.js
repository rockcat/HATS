// ── What an agent does on a timer ─────────────────────────────────────────────
//
// An agent's agenda holds two kinds of entry: copies of the global scheduled
// actions assigned to it, and things it scheduled for itself. Each can be
// switched off here without being lost. A copy's wording belongs to its global
// action — editing it opens that action, so every agent it is assigned to
// changes together — while the agent's own entries are edited in place.

import { esc, fmtLastRun } from './utils.js';
import { openScheduleModal } from './schedules.js';

function intervalText(seconds) {
  if (!seconds) return 'Once';
  const mins = Math.round(seconds / 60);
  return mins >= 60 && mins % 60 === 0 ? `Every ${mins / 60} h` : `Every ${mins} min`;
}

function nextText(entry) {
  if (!entry.enabled) return 'off';
  const mins = Math.round((entry.nextRunAt - Date.now()) / 60_000);
  return mins <= 0 ? 'due now' : `next in ${mins} min`;
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
    <textarea class="agenda-edit-desc" rows="2" placeholder="What to do">${esc(entry.description)}</textarea>
    <label class="agenda-edit-interval">Every
      <input type="number" min="0" value="${entry.intervalSeconds ? Math.round(entry.intervalSeconds / 60) : ''}"> min
      <span class="agenda-hint">(blank = once)</span></label>
    <div class="agenda-edit-btns">
      <button class="library-btn library-btn--add" data-act="save">Save</button>
      <button class="library-btn" data-act="cancel">Cancel</button>
    </div>`;
  form.querySelector('[data-act="cancel"]').addEventListener('click', () => onDone(false));
  form.querySelector('[data-act="save"]').addEventListener('click', async () => {
    const mins = parseFloat(form.querySelector('.agenda-edit-interval input').value);
    try {
      await patch(entry.id, {
        label: form.querySelector('.agenda-edit-label').value.trim() || entry.label,
        description: form.querySelector('.agenda-edit-desc').value.trim(),
        intervalSeconds: mins > 0 ? Math.round(mins * 60) : null,
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
  when.textContent = `${intervalText(entry.intervalSeconds)} · ${nextText(entry)} · ${fmtLastRun(entry.lastRunAt)}`;
  if (entry.lastRunAt) when.title = `Last run ${new Date(entry.lastRunAt).toLocaleString()}`;

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
  del.title = action ? 'Remove from this agent (untick it in the library to keep it off)' : 'Delete';
  del.addEventListener('click', async () => {
    if (!confirm(`Remove "${entry.label}" from this agent?`)) return;
    await fetch(`/api/agenda/${encodeURIComponent(entry.id)}`, { method: 'DELETE' }).catch(() => {});
    reload();
  });

  const actions = document.createElement('div');
  actions.className = 'schedules-row-actions';
  actions.append(edit, del);

  row.append(toggle, body, when, actions);
  return row;
}

async function loadAgenda(name, el) {
  el.innerHTML = '<p class="memory-empty">Loading…</p>';
  try {
    const [entries, actions] = await Promise.all([
      fetch(`/api/agenda?agent=${encodeURIComponent(name)}`).then(r => r.json()),
      fetch('/api/scheduled-actions').then(r => r.json()).catch(() => []),
    ]);
    const byId = new Map(actions.map(a => [a.id, a]));
    el.innerHTML = '';
    if (!entries.length) {
      el.innerHTML = `<p class="memory-empty">${esc(name)} has nothing scheduled.</p>`;
      return;
    }
    for (const e of entries) el.appendChild(entryRow(e, e.actionId ? byId.get(e.actionId) : undefined, () => loadAgenda(name, el)));
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
