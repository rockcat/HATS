// ── Project switcher & goal bar ───────────────────────────────────────────────

// Injected at init time to avoid circular deps with sse.js.
let _applyState            = () => {};
let _fetchTools            = () => {};
let _fetchFiles            = () => {};
let _startFilesRefresh     = () => {};
let _fetchCalendar         = () => {};
let _applyTelemetrySummary = () => {};
let _closeAgentDetail      = () => {};

export function initProject({ applyState, fetchTools, fetchFiles, startFilesRefresh, fetchCalendar, applyTelemetrySummary, closeAgentDetail }) {
  _applyState            = applyState;
  _fetchTools            = fetchTools;
  _fetchFiles            = fetchFiles;
  _startFilesRefresh     = startFilesRefresh;
  _fetchCalendar         = fetchCalendar;
  _applyTelemetrySummary = applyTelemetrySummary;
  _closeAgentDetail      = closeAgentDetail;
}

// ── Goal bar ──────────────────────────────────────────────────────────────────

export function updateGoalBar(goal, tickets) {
  const text = document.getElementById('goal-text');
  if (text) text.textContent = goal ?? '';

  const all    = (tickets ?? []).length;
  const done   = (tickets ?? []).filter(t => t.column === 'closed').length;
  const active = (tickets ?? []).filter(t => ['ready','in_progress','blocked','review'].includes(t.column)).length;
  const todo   = all - done - active;

  const pDone   = all > 0 ? (done   / all * 100).toFixed(1) : 0;
  const pActive = all > 0 ? (active / all * 100).toFixed(1) : 0;
  const pTodo   = all > 0 ? (todo   / all * 100).toFixed(1) : 0;

  const setW = (id, pct) => { const el = document.getElementById(id); if (el) el.style.width = pct + '%'; };
  setW('kp-done',   pDone);
  setW('kp-active', pActive);
  setW('kp-todo',   pTodo);

  const bar = document.getElementById('kanban-progress');
  if (bar) bar.title = all === 0 ? 'No tickets' : `Done: ${done}  Active: ${active}  Todo: ${todo}`;
}

export function initGoalBar() {
  const editBtn = document.getElementById('goal-edit-btn');
  const saveBtn = document.getElementById('goal-save-btn');
  const textEl  = document.getElementById('goal-text');
  const input   = document.getElementById('goal-input');
  if (!editBtn || !saveBtn || !textEl || !input) return;

  editBtn.addEventListener('click', () => {
    input.value    = textEl.textContent;
    textEl.hidden  = true;
    editBtn.hidden = true;
    input.hidden   = false;
    saveBtn.hidden = false;
    input.focus();
  });

  const doSave = () => {
    const goal = input.value.trim();
    fetch('/api/project/goal', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal }),
    }).catch(() => {});
    textEl.textContent = goal;
    input.hidden   = true;
    saveBtn.hidden = true;
    textEl.hidden  = false;
    editBtn.hidden = false;
  };

  saveBtn.addEventListener('click', doSave);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') doSave();
    if (e.key === 'Escape') {
      input.hidden   = true;
      saveBtn.hidden = true;
      textEl.hidden  = false;
      editBtn.hidden = false;
    }
  });
}

// ── Project badge & switcher ──────────────────────────────────────────────────

export function updateProjectBadge(id, dir) {
  const badge = document.getElementById('project-badge');
  if (badge) { badge.textContent = id; badge.title = dir ?? id; }
}

export function initProjectBadge() {
  fetch('/api/project')
    .then(r => r.json())
    .then(({ id, dir }) => updateProjectBadge(id, dir))
    .catch(() => {});

  const badge    = document.getElementById('project-badge');
  const switcher = document.getElementById('project-switcher');

  badge.addEventListener('click', e => {
    e.stopPropagation();
    const open = !switcher.hidden;
    if (open) { switcher.hidden = true; return; }
    switcher.hidden = false;
    document.getElementById('project-switcher-input').value = '';
    loadProjectList();
  });

  document.getElementById('project-switcher-load').addEventListener('click', () => {
    const id = document.getElementById('project-switcher-input').value.trim();
    if (id) doSwitchProject(id);
  });

  document.getElementById('project-switcher-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const id = e.target.value.trim();
      if (id) doSwitchProject(id);
    }
  });

  document.addEventListener('click', e => {
    if (!switcher.hidden && !switcher.contains(e.target) && e.target !== badge) {
      switcher.hidden = true;
    }
  });
}

export function loadProjectList() {
  const list = document.getElementById('project-switcher-list');
  list.innerHTML = '<div class="project-switcher-loading">Loading…</div>';

  fetch('/api/projects')
    .then(r => r.json())
    .then(projects => {
      list.innerHTML = '';
      if (!projects.length) {
        list.innerHTML = '<div class="project-switcher-loading">No projects found.</div>';
        return;
      }
      projects = projects.sort((a, b) => a.id.localeCompare(b.id));
      for (const p of projects) {
        const row = document.createElement('div');
        row.className  = 'project-switcher-row' + (p.active ? ' active' : '');
        row.textContent = p.id;
        row.title       = p.dir;
        if (!p.active) {
          row.addEventListener('click', () => doSwitchProject(p.id));
        }
        list.appendChild(row);
      }
    })
    .catch(() => { list.innerHTML = '<div class="project-switcher-loading">Failed to load.</div>'; });
}

export function doSwitchProject(id) {
  const switcher = document.getElementById('project-switcher');
  const badge    = document.getElementById('project-badge');
  switcher.hidden = true;
  const prevId    = badge.textContent;
  badge.textContent = '…';

  _closeAgentDetail();

  const switchModal = document.getElementById('project-switching-modal');
  document.getElementById('project-switching-name').textContent = id;
  switchModal.hidden = false;

  fetch('/api/project/switch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
    .then(r => r.json())
    .then(res => {
      switchModal.hidden = true;
      if (res.error) {
        badge.textContent = prevId;
        console.error('Project switch failed:', res.error);
        return;
      }
      if (res.agents !== undefined) {
        _applyState({ agents: res.agents, tickets: res.tickets ?? [], humanName: res.project?.humanName ?? 'human' });
      }
      if (res.project) updateProjectBadge(res.project.id, res.project.dir);
      updateGoalBar(res.project?.goal, res.tickets);
      _fetchTools();
      _fetchFiles();
      _startFilesRefresh();
      _fetchCalendar();
      fetch('/api/telemetry').then(r => r.json()).then(d => _applyTelemetrySummary(d.summary)).catch(() => {});
    })
    .catch(() => {
      switchModal.hidden = true;
      badge.textContent  = prevId;
    });
}
