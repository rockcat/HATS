// ── Agent Library tab ─────────────────────────────────────────────────────────

import { esc } from './utils.js';

// Injected to break library ↔ add-agent circular dep.
let _openLibraryEdit = () => {};

export function initLibraryTab({ openLibraryEdit }) {
  _openLibraryEdit = openLibraryEdit;
  document.getElementById('library-refresh-btn')?.addEventListener('click', refreshLibrary);
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

function renderGlobalAgents(agents, projectIds) {
  const list = document.getElementById('library-agent-list');
  if (!list) return;
  if (!agents.length) {
    list.innerHTML = '<div style="padding:16px 12px;color:var(--text-muted);font-size:13px">No agents in the library yet. Create one with the button above.</div>';
    return;
  }
  const byName  = (a, b) => (a.identity?.name ?? '').localeCompare(b.identity?.name ?? '');
  const inProj  = agents.filter(a =>  projectIds.has(a.id)).sort(byName);
  const notProj = agents.filter(a => !projectIds.has(a.id)).sort(byName);
  const sorted  = [...inProj, ...notProj];

  list.innerHTML = sorted.map(agent => {
    const hats   = (agent.hatType ?? []).filter(h => h !== 'none').map(h => h.charAt(0).toUpperCase() + h.slice(1)).join('+') || 'No Hat';
    const active = projectIds.has(agent.id);
    return `
      <div class="library-agent-row${active ? ' library-agent-row--active' : ''}" data-agent-id="${agent.id}" style="cursor:pointer" title="Click to edit the library template — agents already in projects keep their own settings">
        <div class="library-agent-body" style="flex:1;min-width:0">
          <div class="library-agent-name">${esc(agent.identity?.name ?? 'Unnamed')}</div>
          <div class="library-agent-meta">${esc(hats)} · ${esc(agent.model ?? '')}</div>
        </div>
        ${active ? '<span class="library-agent-in-project">In project</span>' : ''}
        <div class="library-agent-actions">
          ${active ? '' : `<button class="library-btn library-btn--add" data-action="add" data-agent-id="${agent.id}">+ Add to project</button>`}
          <button class="library-btn library-btn--del" data-action="delete" data-agent-id="${agent.id}" title="Remove from library">✕</button>
        </div>
      </div>`;
  }).join('');

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
      const name    = btn.closest('.library-agent-row').querySelector('.library-agent-name')?.textContent ?? agentId;
      if (!confirm(`Remove "${name}" from the global library? This does not affect active projects.`)) return;
      try {
        await fetch(`/api/global-agents/${encodeURIComponent(agentId)}`, { method: 'DELETE' });
        fetchGlobalAgents();
      } catch { alert('Network error'); }
    });
  });

  list.querySelectorAll('.library-agent-row').forEach(row => {
    row.addEventListener('click', () => {
      const agentId = row.dataset.agentId;
      const agent   = agents.find(a => a.id === agentId);
      if (agent) _openLibraryEdit(agent);
    });
  });
}
