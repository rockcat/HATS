// ── Agent Library tab ─────────────────────────────────────────────────────────

import { esc } from './utils.js';
import { getAvatars } from './avatars.js';
import { avatarThumbnail } from './avatar-thumbs.js';

// Injected to break library ↔ add-agent circular dep.
let _openLibraryEdit = () => {};

/** 'list' or 'grid', remembered in this browser. */
const VIEW_KEY = 'libraryView';
let view = readView();

function readView() {
  try { return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list'; } catch { return 'list'; }
}

function saveView(value) {
  try { localStorage.setItem(VIEW_KEY, value); } catch { /* private window: keep it for this page only */ }
}

export function initLibraryTab({ openLibraryEdit }) {
  _openLibraryEdit = openLibraryEdit;
  document.getElementById('library-refresh-btn')?.addEventListener('click', refreshLibrary);
  document.getElementById('library-view-btn')?.addEventListener('click', () => {
    view = view === 'grid' ? 'list' : 'grid';
    saveView(view);
    showViewButton();
    fetchGlobalAgents();
  });
  showViewButton();
}

/** The toggle offers the view you are not in. */
function showViewButton() {
  const btn = document.getElementById('library-view-btn');
  if (!btn) return;
  const next = view === 'grid' ? 'list' : 'grid';
  btn.title = `Show as a ${next}`;
  btn.innerHTML = `<img src="assets/view-${next}.svg" class="svg-icon" alt="${next === 'grid' ? 'Grid' : 'List'} view">`;
}

/** Text for where the library's entries come from, as the refresh route reports it. */
const describeSource = (source) =>
  source?.kind === 'library' ? 'from the Agent Library service'
  : source?.kind === 'local' ? 'local file — Agent Library service not answering'
  : '';

/** Ask the runner to read the library again, then redraw it. */
async function refreshLibrary() {
  const btn    = document.getElementById('library-refresh-btn');
  const status = document.getElementById('library-source');
  btn?.classList.add('is-busy');
  if (btn) btn.disabled = true;
  try {
    const r    = await fetch('/api/global-agents/refresh', { method: 'POST' });
    const body = await r.json();
    if (status) status.textContent = r.ok ? describeSource(body.source) : (body.error ?? 'Refresh failed');
  } catch {
    if (status) status.textContent = 'Refresh failed — runner not answering';
  } finally {
    btn?.classList.remove('is-busy');
    if (btn) btn.disabled = false;
  }
  await fetchGlobalAgents();
}

export async function fetchGlobalAgents() {
  try {
    const [globalAgents, projectAgents] = await Promise.all([
      fetch('/api/global-agents').then(r => r.json()),
      fetch('/api/agents').then(r => r.json()),
    ]);
    // A project's agent is a copy that points back at its template.
    renderGlobalAgents(globalAgents, new Set(projectAgents.map(a => a.templateId ?? a.id ?? a.name)));
  } catch { /* ignore */ }
}

// ── Pieces shared by both views ─────────────────────────────────────────────

const hatsOf = (agent) => (agent.hatType ?? []).filter(h => h !== 'none');

const hatLabel = (agent) =>
  hatsOf(agent).map(h => h.charAt(0).toUpperCase() + h.slice(1)).join('+') || 'No Hat';

const initials = (name) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';

/** The add and delete buttons; the add button only for agents not yet in the project. */
const actionButtons = (agent, active) => `
  ${active ? '' : `<button class="library-btn library-btn--add" data-action="add" data-agent-id="${esc(agent.id)}">+ Add to project</button>`}
  <button class="library-btn library-btn--del" data-action="delete" data-agent-id="${esc(agent.id)}" title="Remove from library">✕</button>`;

const EDIT_TITLE = 'Click to edit the library template — agents already in projects keep their own settings';

// ── List view ───────────────────────────────────────────────────────────────

const rowHtml = (agent, active) => `
  <div class="library-item library-agent-row${active ? ' library-agent-row--active' : ''}" data-agent-id="${esc(agent.id)}" title="${EDIT_TITLE}">
    <div class="library-agent-body" style="flex:1;min-width:0">
      <div class="library-agent-name">${esc(agent.identity?.name ?? 'Unnamed')}</div>
      <div class="library-agent-meta">${esc(hatLabel(agent))} · ${esc(agent.model ?? '')}</div>
    </div>
    ${active ? '<span class="library-agent-in-project">In project</span>' : ''}
    <div class="library-agent-actions">${actionButtons(agent, active)}</div>
  </div>`;

// ── Grid view ───────────────────────────────────────────────────────────────

function cardHtml(agent, active) {
  const name       = agent.identity?.name ?? 'Unnamed';
  const avatar     = agent.identity?.avatar;
  const background = agent.identity?.background;
  const bgStyle    = background ? ` style="background-image:url('/backgrounds/${encodeURIComponent(background)}')"` : '';
  const dots       = hatsOf(agent).map(h => `<span class="library-hat-dot" style="background:var(--hat-${esc(h)})" title="${esc(h)} hat"></span>`).join('');
  return `
  <div class="library-item library-card${active ? ' library-card--active' : ''}" data-agent-id="${esc(agent.id)}" title="${EDIT_TITLE}">
    <div class="library-card-portrait"${bgStyle}>
      <div class="library-card-initials">${esc(initials(name))}</div>
      ${avatar ? `<img class="library-card-avatar" data-avatar="${esc(avatar)}" alt="">` : ''}
      ${active ? '<span class="library-agent-in-project library-card-badge">In project</span>' : ''}
    </div>
    <div class="library-card-body">
      <div class="library-agent-name">${esc(name)}</div>
      <div class="library-agent-meta">${dots}<span class="library-card-model">${esc(agent.model ?? '')}</span></div>
    </div>
    <div class="library-card-actions">${actionButtons(agent, active)}</div>
  </div>`;
}

/** Fill each card's portrait as its thumbnail is drawn; the initials stay if it can't be. */
async function fillPortraits(list) {
  const imgs = [...list.querySelectorAll('img[data-avatar]')];
  if (!imgs.length) return;
  const catalogue = await getAvatars();
  for (const img of imgs) {
    const file = img.dataset.avatar;
    avatarThumbnail(file, catalogue.find(a => a.file === file)).then((url) => {
      if (!url || !img.isConnected) return;
      img.src = url;
      img.closest('.library-card-portrait')?.classList.add('has-avatar');
    });
  }
}

// ── Render ──────────────────────────────────────────────────────────────────

function renderGlobalAgents(agents, projectIds) {
  const list = document.getElementById('library-agent-list');
  if (!list) return;
  list.classList.toggle('library-agent-list--grid', view === 'grid');
  if (!agents.length) {
    list.innerHTML = '<div style="padding:16px 12px;color:var(--text-muted);font-size:13px">No agents in the library yet. Create one with the button above.</div>';
    return;
  }
  const byName  = (a, b) => (a.identity?.name ?? '').localeCompare(b.identity?.name ?? '');
  const inProj  = agents.filter(a =>  projectIds.has(a.id)).sort(byName);
  const notProj = agents.filter(a => !projectIds.has(a.id)).sort(byName);
  const sorted  = [...inProj, ...notProj];

  const itemHtml = view === 'grid' ? cardHtml : rowHtml;
  list.innerHTML = sorted.map(agent => itemHtml(agent, projectIds.has(agent.id))).join('');
  if (view === 'grid') fillPortraits(list);

  list.querySelectorAll('[data-action="add"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const agentId = btn.dataset.agentId;
      try {
        const r = await fetch('/api/project/add-agent', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId }),
        });
        if (!r.ok) { const e2 = await r.json(); alert(e2.error ?? 'Failed to add agent'); return; }
        fetchGlobalAgents();
      } catch { alert('Network error'); }
    });
  });

  list.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const agentId = btn.dataset.agentId;
      const name    = btn.closest('.library-item').querySelector('.library-agent-name')?.textContent ?? agentId;
      if (!confirm(`Remove "${name}" from the global library? This does not affect active projects.`)) return;
      try {
        await fetch(`/api/global-agents/${encodeURIComponent(agentId)}`, { method: 'DELETE' });
        fetchGlobalAgents();
      } catch { alert('Network error'); }
    });
  });

  list.querySelectorAll('.library-item').forEach(item => {
    item.addEventListener('click', () => {
      const agentId = item.dataset.agentId;
      const agent   = agents.find(a => a.id === agentId);
      if (agent) _openLibraryEdit(agent);
    });
  });
}
