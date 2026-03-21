// ── Constants ────────────────────────────────────────────────────────────────

const HAT = {
  white:  { bar: '#e6edf3', label: '#0d1117', bg: 'rgba(230,237,243,0.12)' },
  red:    { bar: '#f85149', label: '#f85149', bg: 'rgba(248,81,73,0.12)'   },
  black:  { bar: '#8b949e', label: '#8b949e', bg: 'rgba(139,148,158,0.12)' },
  yellow: { bar: '#e3b341', label: '#e3b341', bg: 'rgba(227,179,65,0.12)'  },
  green:  { bar: '#3fb950', label: '#3fb950', bg: 'rgba(63,185,80,0.12)'   },
  blue:   { bar: '#58a6ff', label: '#58a6ff', bg: 'rgba(88,166,255,0.12)'  },
};

const STATE_LABEL = {
  idle:             'Idle',
  working:          'Working',
  waiting_for_help: 'Waiting for help',
  in_discussion:    'In discussion',
};

// ── State ─────────────────────────────────────────────────────────────────────

let state = { agents: [], tickets: [] };

// ── Hat helpers ───────────────────────────────────────────────────────────────

function hat(type) { return HAT[type] || HAT.white; }

// ── Agent rendering ───────────────────────────────────────────────────────────

function renderAgents(agents) {
  const container = document.getElementById('agents-container');
  const existing = new Map(
    [...container.querySelectorAll('.agent-card')].map(el => [el.dataset.name, el])
  );

  for (const agent of agents) {
    const card = existing.get(agent.name);
    if (card) {
      updateCard(card, agent);
      existing.delete(agent.name);
    } else {
      container.appendChild(createCard(agent));
    }
  }

  for (const el of existing.values()) el.remove();

  reorderCards(container, agents);
  updateCommsOverlay(agents, container);
}

function createCard(agent) {
  const c = hat(agent.hatType);
  const el = document.createElement('div');
  el.className = 'agent-card';
  el.dataset.name = agent.name;
  el.innerHTML = `
    <div class="agent-hat-bar"></div>
    <div class="agent-header">
      <span class="agent-name"></span>
      <span class="agent-hat-badge"></span>
    </div>
    <div class="agent-state">
      <div class="state-dot"></div>
      <span class="state-label"></span>
    </div>
    <div class="agent-activity">
      <div class="agent-activity-text"></div>
    </div>
  `;
  applyCardData(el, agent);
  return el;
}

function updateCard(el, agent) {
  applyCardData(el, agent);
}

function applyCardData(el, agent) {
  const c = hat(agent.hatType);

  el.querySelector('.agent-hat-bar').style.background = c.bar;
  el.querySelector('.agent-name').textContent = agent.name;

  const badge = el.querySelector('.agent-hat-badge');
  badge.textContent = agent.hatType + ' hat';
  badge.style.color = c.label;
  badge.style.background = c.bg;

  const dot = el.querySelector('.state-dot');
  dot.className = 'state-dot ' + agent.state;
  el.querySelector('.state-label').textContent = STATE_LABEL[agent.state] || agent.state;

  el.querySelector('.agent-activity-text').textContent = agent.activity || '';

  // Talking-to line
  let talkEl = el.querySelector('.agent-talking-to');
  if (agent.talkingTo) {
    if (!talkEl) {
      talkEl = document.createElement('div');
      talkEl.className = 'agent-talking-to';
      el.querySelector('.agent-activity').appendChild(talkEl);
    }
    talkEl.textContent = '↔ ' + agent.talkingTo;
    el.classList.add('communicating');
  } else {
    if (talkEl) talkEl.remove();
    el.classList.remove('communicating');
  }
}

// ── Card reordering (FLIP) ────────────────────────────────────────────────────

function reorderCards(container, agents) {
  const ordered = buildOrder(agents);

  // First: capture positions
  const first = new Map(
    [...container.querySelectorAll('.agent-card')]
      .map(el => [el.dataset.name, el.getBoundingClientRect()])
  );

  // Reorder DOM
  for (const name of ordered) {
    const el = container.querySelector(`.agent-card[data-name="${CSS.escape(name)}"]`);
    if (el) container.insertBefore(el, container.querySelector('#comms-overlay'));
  }

  // Play FLIP
  for (const name of ordered) {
    const el = container.querySelector(`.agent-card[data-name="${CSS.escape(name)}"]`);
    if (!el) continue;
    const f = first.get(name);
    const l = el.getBoundingClientRect();
    if (!f) continue;
    const dx = f.left - l.left;
    const dy = f.top - l.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;

    el.style.transition = 'none';
    el.style.transform = `translate(${dx}px,${dy}px)`;
    requestAnimationFrame(() => {
      el.style.transition = 'transform 0.45s cubic-bezier(0.25,0.46,0.45,0.94)';
      el.style.transform = '';
      el.addEventListener('transitionend', () => {
        el.style.transition = '';
      }, { once: true });
    });
  }
}

/** Sort agents so communicating pairs are adjacent. */
function buildOrder(agents) {
  const order = agents.map(a => a.name);

  for (const agent of agents) {
    if (!agent.talkingTo) continue;
    const ai = order.indexOf(agent.name);
    const bi = order.indexOf(agent.talkingTo);
    if (ai < 0 || bi < 0 || Math.abs(ai - bi) <= 1) continue;
    order.splice(bi, 1);
    const newAi = order.indexOf(agent.name);
    order.splice(newAi + 1, 0, agent.talkingTo);
  }

  return order;
}

// ── Communication overlay ─────────────────────────────────────────────────────

function updateCommsOverlay(agents, container) {
  const svg = document.getElementById('comms-overlay');
  svg.innerHTML = '';

  // Size SVG to container scroll area
  const cr = container.getBoundingClientRect();
  svg.setAttribute('viewBox', `0 0 ${cr.width} ${cr.height}`);
  svg.setAttribute('width', cr.width);
  svg.setAttribute('height', cr.height);

  const drawn = new Set();
  for (const agent of agents) {
    if (!agent.talkingTo) continue;
    const key = [agent.name, agent.talkingTo].sort().join('|');
    if (drawn.has(key)) continue;
    drawn.add(key);

    const elA = container.querySelector(`.agent-card[data-name="${CSS.escape(agent.name)}"]`);
    const elB = container.querySelector(`.agent-card[data-name="${CSS.escape(agent.talkingTo)}"]`);
    if (!elA || !elB) continue;

    const rA = elA.getBoundingClientRect();
    const rB = elB.getBoundingClientRect();

    const x1 = rA.left - cr.left + rA.width / 2;
    const y1 = rA.top  - cr.top  + rA.height / 2;
    const x2 = rB.left - cr.left + rB.width / 2;
    const y2 = rB.top  - cr.top  + rB.height / 2;

    // Dashed connection line
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1); line.setAttribute('y1', y1);
    line.setAttribute('x2', x2); line.setAttribute('y2', y2);
    line.setAttribute('stroke', '#8957e5');
    line.setAttribute('stroke-width', '1.5');
    line.setAttribute('stroke-dasharray', '5 4');
    line.setAttribute('opacity', '0.45');
    svg.appendChild(line);

    // Travelling dot
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('r', '3');
    dot.setAttribute('fill', '#8957e5');
    const anim = document.createElementNS('http://www.w3.org/2000/svg', 'animateMotion');
    anim.setAttribute('dur', '1.8s');
    anim.setAttribute('repeatCount', 'indefinite');
    anim.setAttribute('path', `M${x1},${y1} L${x2},${y2}`);
    dot.appendChild(anim);
    svg.appendChild(dot);
  }
}

// ── Kanban rendering ──────────────────────────────────────────────────────────

const PRIORITY_COLOR = {
  critical: '#f85149',
  high:     '#e3b341',
  medium:   '#58a6ff',
  low:      '#8b949e',
};

// Active kanban columns (top-right)
const ACTIVE_COLUMNS = ['ready', 'in_progress', 'blocked', 'completed'];

function renderKanban(tickets) {
  // Active columns
  for (const colId of ACTIVE_COLUMNS) {
    const colEl = document.getElementById(`col-${colId}`);
    if (!colEl) continue;
    const colTickets = tickets.filter(t => t.column === colId);
    colEl.querySelector('.kanban-col-count').textContent = colTickets.length || '';
    const list = colEl.querySelector('.task-list');
    list.innerHTML = colTickets.length
      ? colTickets.map(ticketHTML).join('')
      : '<p class="empty-hint">No tickets</p>';
  }

  // Backlog (wide list)
  const backlog = tickets.filter(t => t.column === 'backlog');
  const countEl = document.getElementById('backlog-count');
  if (countEl) countEl.textContent = backlog.length || '';
  const listEl = document.getElementById('backlog-list');
  if (listEl) {
    listEl.innerHTML = backlog.length
      ? backlog.map(backlogRowHTML).join('')
      : '<p class="backlog-empty">No tickets in backlog</p>';
  }
}

function ticketHTML(ticket) {
  const priority = ticket.priority ?? 'medium';
  const priColor = PRIORITY_COLOR[priority] ?? PRIORITY_COLOR.medium;
  const title    = ticket.title ?? ticket.description?.slice(0, 60) ?? ticket.id;
  const assignee = ticket.assignee ?? '—';
  const tags     = (ticket.tags ?? []).slice(0, 3);

  const tagsHTML = tags.map(t =>
    `<span class="ticket-tag">${esc(t)}</span>`
  ).join('');

  return `
    <div class="task-card" data-ticket-id="${esc(ticket.id)}" title="Click to edit">
      <div class="ticket-top">
        <span class="ticket-id">${esc(ticket.id)}</span>
        <span class="priority-badge" style="color:${priColor};border-color:${priColor}40">${esc(priority)}</span>
      </div>
      <div class="ticket-title">${esc(title)}</div>
      <div class="task-footer">
        <span class="task-assignee">${esc(assignee)}</span>
        ${tagsHTML}
      </div>
    </div>`;
}

function backlogRowHTML(ticket) {
  const priority = ticket.priority ?? 'medium';
  const priColor = PRIORITY_COLOR[priority] ?? PRIORITY_COLOR.medium;
  const title    = ticket.title ?? ticket.description?.slice(0, 80) ?? ticket.id;
  const assignee = ticket.assignee ?? '—';
  const tags     = (ticket.tags ?? []).slice(0, 2)
    .map(t => `<span class="ticket-tag">${esc(t)}</span>`).join('');

  return `
    <div class="backlog-row" data-ticket-id="${esc(ticket.id)}" title="Click to edit">
      <span class="backlog-id">${esc(ticket.id)}</span>
      <span class="backlog-title">${esc(title)}</span>
      <span class="backlog-assignee">${esc(assignee)}</span>
      <span class="backlog-tags">${tags}</span>
      <span class="backlog-priority" style="color:${priColor};border-color:${priColor}40">${esc(priority)}</span>
    </div>`;
}

// ── Ticket edit modal ─────────────────────────────────────────────────────────

let currentEditId = null;
let ticketEditingInited = false;

function initTicketEditing() {
  if (ticketEditingInited) return;
  ticketEditingInited = true;
  // Event delegation — works even after innerHTML re-renders
  document.getElementById('kanban-active').addEventListener('click', e => {
    const card = e.target.closest('[data-ticket-id]');
    if (card) openTicketModal(card.dataset.ticketId);
  });
  document.getElementById('backlog-list').addEventListener('click', e => {
    const row = e.target.closest('[data-ticket-id]');
    if (row) openTicketModal(row.dataset.ticketId);
  });

  document.getElementById('new-ticket-btn').addEventListener('click', openNewTicketModal);
  document.getElementById('modal-close').addEventListener('click', closeTicketModal);
  document.getElementById('modal-cancel').addEventListener('click', closeTicketModal);
  document.getElementById('modal-save').addEventListener('click', saveTicket);

  // Close on overlay click (outside the modal card)
  document.getElementById('ticket-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeTicketModal();
  });

  // Close on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !document.getElementById('ticket-modal').hidden) closeTicketModal();
  });
}

function openNewTicketModal() {
  document.getElementById('modal-ticket-id').textContent = 'New Ticket';
  document.getElementById('edit-title').value       = '';
  document.getElementById('edit-description').value = '';
  document.getElementById('edit-priority').value    = 'medium';
  document.getElementById('edit-column').value      = 'backlog';
  document.getElementById('edit-assignee').value    = '';
  document.getElementById('edit-tags').value        = '';
  document.getElementById('modal-error').textContent = '';
  document.getElementById('modal-save').textContent = 'Create ticket';

  currentEditId = null;
  document.getElementById('ticket-modal').hidden = false;
  document.getElementById('edit-title').focus();
}

function openTicketModal(id) {
  const ticket = state.tickets.find(t => t.id === id);
  if (!ticket) return;

  document.getElementById('modal-ticket-id').textContent = id;
  document.getElementById('edit-title').value       = ticket.title ?? '';
  document.getElementById('edit-description').value = ticket.description ?? '';
  document.getElementById('edit-priority').value    = ticket.priority ?? 'medium';
  document.getElementById('edit-column').value      = ticket.column ?? 'backlog';
  document.getElementById('edit-assignee').value    = ticket.assignee ?? '';
  document.getElementById('edit-tags').value        = (ticket.tags ?? []).join(', ');
  document.getElementById('modal-error').textContent = '';
  document.getElementById('modal-save').textContent = 'Save changes';

  currentEditId = id;
  document.getElementById('ticket-modal').hidden = false;
  document.getElementById('edit-title').focus();
}

function closeTicketModal() {
  document.getElementById('ticket-modal').hidden = true;
  currentEditId = null;
}

function saveTicket() {
  const saveBtn = document.getElementById('modal-save');
  saveBtn.disabled = true;
  const originalLabel = saveBtn.textContent;
  saveBtn.textContent = 'Saving…';

  const body = {
    title:       document.getElementById('edit-title').value.trim(),
    description: document.getElementById('edit-description').value.trim(),
    priority:    document.getElementById('edit-priority').value,
    column:      document.getElementById('edit-column').value,
    assignee:    document.getElementById('edit-assignee').value.trim() || null,
    tags:        document.getElementById('edit-tags').value
                   .split(',').map(t => t.trim()).filter(Boolean),
  };

  const isCreate = currentEditId === null;
  const url    = isCreate ? '/api/kanban/tickets' : `/api/kanban/tickets/${encodeURIComponent(currentEditId)}`;
  const method = isCreate ? 'POST' : 'PATCH';

  fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(r => r.json())
    .then(result => {
      if (result.error) {
        document.getElementById('modal-error').textContent = result.error;
      } else {
        closeTicketModal();
      }
    })
    .catch(err => {
      document.getElementById('modal-error').textContent = String(err);
    })
    .finally(() => {
      saveBtn.disabled = false;
      saveBtn.textContent = originalLabel;
    });
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// ── Tools rendering ───────────────────────────────────────────────────────────

function renderTools(tools) {
  const el = document.getElementById('tools-content');
  if (!el) return;

  let html = '';

  // Built-in tools
  if (tools.builtin && tools.builtin.length > 0) {
    html += `<div class="tools-section-label">Built-in</div>`;
    for (const tool of tools.builtin) {
      const badges = (tool.agents ?? [])
        .map(a => `<span class="tool-agent-badge">${esc(a)}</span>`)
        .join('');
      html += `
        <div class="tool-row">
          <span class="tool-name">${esc(tool.name)}</span>
          <span class="tool-desc">${esc(tool.description)}</span>
          ${badges ? `<div class="tool-agents">${badges}</div>` : ''}
        </div>`;
    }
  }

  // MCP tools grouped by server
  if (tools.mcp && tools.mcp.length > 0) {
    html += `<div class="tools-section-label" style="margin-top:6px">MCP Servers</div>`;
    for (const server of tools.mcp) {
      html += `
        <div class="tool-row">
          <div class="mcp-server-header">
            <span class="mcp-server-dot"></span>
            <span class="mcp-server-name">${esc(server.server)}</span>
            <span style="font-size:10px;color:var(--text-muted)">${server.tools.length} tools</span>
          </div>`;
      for (const tool of server.tools) {
        html += `
          <div style="padding:3px 0 3px 12px;border-top:1px solid var(--border)">
            <span class="tool-name" style="font-size:10px">${esc(tool.name)}</span>
            <span class="tool-desc" style="display:block">${esc(tool.description)}</span>
          </div>`;
      }
      html += `</div>`;
    }
  }

  if (!html) {
    html = '<p class="tools-empty">No tools loaded yet</p>';
  }

  el.innerHTML = html;
}

// ── State application ─────────────────────────────────────────────────────────

function applyState(newState) {
  state = newState;
  renderAgents(state.agents);
  renderKanban(state.tickets);
}

// ── SSE connection ────────────────────────────────────────────────────────────

function connect() {
  const dot = document.getElementById('connection-status');
  const es = new EventSource('/events');

  es.onopen = () => dot.classList.add('connected');
  es.onerror = () => {
    dot.classList.remove('connected');
    es.close();
    setTimeout(connect, 3000);
  };

  es.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'init') {
      applyState({ agents: msg.agents, tickets: msg.tickets });
      fetchTools();
      initTabs();
      initTicketEditing();
    } else if (msg.type === 'agent_update') {
      state.agents = msg.agents;
      renderAgents(state.agents);
    } else if (msg.type === 'kanban_update') {
      state.tickets = msg.tickets;
      renderKanban(state.tickets);
    } else if (msg.type === 'tools_update') {
      renderTools(msg.tools);
    }
  };
}

function fetchTools() {
  fetch('/api/tools')
    .then(r => r.json())
    .then(tools => renderTools(tools))
    .catch(() => {});
}

// ── MCP Catalogue ─────────────────────────────────────────────────────────────

const CATEGORY_COLOR = {
  productivity: { bg: 'rgba(88,166,255,0.12)',  text: '#58a6ff'  },
  files:        { bg: 'rgba(63,185,80,0.12)',   text: '#3fb950'  },
  web:          { bg: 'rgba(227,179,65,0.12)',  text: '#e3b341'  },
  data:         { bg: 'rgba(248,81,73,0.12)',   text: '#f85149'  },
  dev:          { bg: 'rgba(139,148,158,0.12)', text: '#8b949e'  },
};

function renderMCPCatalogue(catalogue) {
  const el = document.getElementById('mcp-content');
  if (!el) return;

  const categories = [...new Set(catalogue.map(e => e.category))];
  let html = '';

  for (const cat of categories) {
    const entries = catalogue.filter(e => e.category === cat);
    const cc = CATEGORY_COLOR[cat] || CATEGORY_COLOR.dev;
    html += `<div class="mcp-cat-label" style="color:${cc.text}">${esc(cat)}</div>`;
    for (const entry of entries) {
      const envHtml = (entry.envStatus ?? []).map(v =>
        `<span class="mcp-env-badge ${v.present ? 'present' : 'missing'}" title="${v.present ? 'Set' : 'Not set'}">${esc(v.name)}</span>`
      ).join('');
      const catBadge = `<span class="mcp-cat-badge" style="background:${cc.bg};color:${cc.text}">${esc(cat)}</span>`;

      html += `
        <div class="mcp-entry ${entry.enabled ? 'enabled' : ''}" data-id="${esc(entry.id)}">
          <div class="mcp-entry-main">
            <div class="mcp-entry-title">
              <span class="mcp-entry-name">${esc(entry.name)}</span>
              ${catBadge}
              ${envHtml}
            </div>
            <div class="mcp-entry-desc">${esc(entry.description)}</div>
          </div>
          <button class="mcp-toggle ${entry.enabled ? 'on' : 'off'}" data-id="${esc(entry.id)}" title="${entry.enabled ? 'Disable' : 'Enable'}">
            <span class="mcp-toggle-knob"></span>
          </button>
        </div>`;
    }
  }

  el.innerHTML = html || '<p class="tools-empty">No servers in catalogue</p>';

  // Wire toggle buttons
  el.querySelectorAll('.mcp-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      toggleMCP(btn.dataset.id, btn.classList.contains('off'), btn);
    });
  });
}

function toggleMCP(id, enable, btn) {
  // Optimistic: immediately show new state and disable while in-flight
  const wasOn = !enable;
  btn.disabled = true;
  btn.classList.add('loading');
  btn.classList.toggle('on', enable);
  btn.classList.toggle('off', !enable);

  // Clear any previous error on the entry
  const entry = btn.closest('.mcp-entry');
  if (entry) entry.querySelector('.mcp-entry-error')?.remove();

  const url = enable ? '/api/mcp/enable' : '/api/mcp/disable';
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
    .then(r => r.json())
    .then(result => {
      if (result.error) {
        // Revert optimistic state
        btn.classList.toggle('on', wasOn);
        btn.classList.toggle('off', !wasOn);
        // Show error in the entry
        if (entry) {
          const errEl = document.createElement('div');
          errEl.className = 'mcp-entry-error';
          errEl.textContent = result.error;
          entry.querySelector('.mcp-entry-main')?.appendChild(errEl);
        }
      } else {
        fetchMCPCatalogue();
      }
    })
    .catch(err => {
      // Revert optimistic state
      btn.classList.toggle('on', wasOn);
      btn.classList.toggle('off', !wasOn);
      if (entry) {
        const errEl = document.createElement('div');
        errEl.className = 'mcp-entry-error';
        errEl.textContent = String(err);
        entry.querySelector('.mcp-entry-main')?.appendChild(errEl);
      }
    })
    .finally(() => {
      btn.disabled = false;
      btn.classList.remove('loading');
    });
}

function fetchMCPCatalogue() {
  fetch('/api/mcp/catalogue')
    .then(r => r.json())
    .then(catalogue => renderMCPCatalogue(catalogue))
    .catch(() => {});
}

// ── Tab switching ─────────────────────────────────────────────────────────────

function initTabs() {
  document.querySelectorAll('.panel-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.panel-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === tab + '-content'));
      if (tab === 'mcp') fetchMCPCatalogue();
    });
  });
}

connect();
