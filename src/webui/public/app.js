// ── Constants ────────────────────────────────────────────────────────────────

const HAT = {
  white:  { bar: '#e6edf3', label: '#0d1117', bg: 'rgba(230,237,243,0.12)' },
  red:    { bar: '#f85149', label: '#f85149', bg: 'rgba(248,81,73,0.12)'   },
  black:  { bar: '#8b949e', label: '#8b949e', bg: 'rgba(139,148,158,0.12)' },
  yellow: { bar: '#e3b341', label: '#e3b341', bg: 'rgba(227,179,65,0.12)'  },
  green:  { bar: '#3fb950', label: '#3fb950', bg: 'rgba(63,185,80,0.12)'   },
  blue:   { bar: '#58a6ff', label: '#58a6ff', bg: 'rgba(88,166,255,0.12)'  },
};

const HAT_DESC = {
  white:  'Facts',
  yellow: 'Optimism',
  black:  'Caution',
  red:    'Emotion',
  green:  'Creativity',
  blue:   'Process',
};

function hatLabel(type) {
  const desc = HAT_DESC[type];
  return desc ? `${type} hat — ${desc}` : `${type} hat`;
}

const STATE_LABEL = {
  idle:             'Idle',
  working:          'Working',
  waiting_for_help: 'Waiting for help',
  in_discussion:    'In discussion',
};

// ── State ─────────────────────────────────────────────────────────────────────

let state = { agents: [], tickets: [] };

// ── Avatar catalogue ──────────────────────────────────────────────────────────

let avatarList = null; // cached from /api/avatars

async function getAvatars() {
  if (avatarList) return avatarList;
  try {
    const res = await fetch('/api/avatars');
    const data = await res.json();
    avatarList = data.avatars || [];
  } catch {
    avatarList = [];
  }
  return avatarList;
}

function findAvatarForAgent(name) {
  if (!avatarList) return null;
  // Check localStorage override first, then fall back to name match
  const overrides = getAvatarOverrides();
  const overrideFile = overrides[name];
  if (overrideFile) {
    const found = avatarList.find(a => a.file === overrideFile);
    if (found) return found;
  }
  return avatarList.find(a => a.name.toLowerCase() === name.toLowerCase()) || null;
}

function getAvatarOverrides() {
  try { return JSON.parse(localStorage.getItem('agentAvatars') || '{}'); } catch { return {}; }
}

function setAvatarOverride(agentName, avatarFile) {
  const overrides = getAvatarOverrides();
  if (avatarFile) overrides[agentName] = avatarFile;
  else delete overrides[agentName];
  localStorage.setItem('agentAvatars', JSON.stringify(overrides));
}

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

  // reorderCards intentionally removed — agents stay in their original positions
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
  el.style.cursor = 'pointer';

  el.querySelector('.agent-hat-bar').style.background = c.bar;
  el.querySelector('.agent-name').textContent = agent.name;

  const badge = el.querySelector('.agent-hat-badge');
  badge.textContent = hatLabel(agent.hatType);
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
  const priority    = ticket.priority ?? 'medium';
  const priColor    = PRIORITY_COLOR[priority] ?? PRIORITY_COLOR.medium;
  const title       = ticket.title ?? ticket.description?.slice(0, 60) ?? ticket.id;
  const assignee    = ticket.assignee ?? '—';
  const tags        = (ticket.tags ?? []).slice(0, 3);
  const projectName = ticket.projectName ?? '';

  const tagsHTML = tags.map(t =>
    `<span class="ticket-tag">${esc(t)}</span>`
  ).join('');

  const projectHTML = projectName
    ? `<div class="ticket-project" title="${esc(ticket.projectFolder ?? '')}">📁 ${esc(projectName)}</div>`
    : '';

  return `
    <div class="task-card" data-ticket-id="${esc(ticket.id)}" draggable="true" title="Drag to move · Click to edit">
      <div class="ticket-top">
        <span class="ticket-id">${esc(ticket.id)}</span>
        <span class="priority-badge" style="color:${priColor};border-color:${priColor}40">${esc(priority)}</span>
      </div>
      <div class="ticket-title">${esc(title)}</div>
      ${projectHTML}
      <div class="task-footer">
        <span class="task-assignee">${esc(assignee)}</span>
        ${tagsHTML}
      </div>
    </div>`;
}

function backlogRowHTML(ticket) {
  const priority    = ticket.priority ?? 'medium';
  const priColor    = PRIORITY_COLOR[priority] ?? PRIORITY_COLOR.medium;
  const title       = ticket.title ?? ticket.description?.slice(0, 80) ?? ticket.id;
  const assignee    = ticket.assignee ?? '—';
  const tags        = (ticket.tags ?? []).slice(0, 2)
    .map(t => `<span class="ticket-tag">${esc(t)}</span>`).join('');
  const projectName = ticket.projectName ?? '';

  return `
    <div class="backlog-row" data-ticket-id="${esc(ticket.id)}" draggable="true" title="Drag to move · Click to edit">
      <span class="backlog-id">${esc(ticket.id)}</span>
      <span class="backlog-title">${esc(title)}</span>
      <span class="backlog-project">${projectName ? `📁 ${esc(projectName)}` : ''}</span>
      <span class="backlog-assignee">${esc(assignee)}</span>
      <span class="backlog-tags">${tags}</span>
      <span class="backlog-priority" style="color:${priColor};border-color:${priColor}40">${esc(priority)}</span>
    </div>`;
}

// ── Kanban drag & drop ────────────────────────────────────────────────────────

let draggedTicketId = null;
let kanbanDragInited = false;

function initKanbanDrag() {
  if (kanbanDragInited) return;
  kanbanDragInited = true;

  const active  = document.getElementById('kanban-active');
  const backlog = document.getElementById('backlog-list');

  // Delegation: dragstart / dragend on the dynamic cards
  [active, backlog].forEach(container => {
    container.addEventListener('dragstart', e => {
      const card = e.target.closest('[data-ticket-id]');
      if (!card) return;
      draggedTicketId = card.dataset.ticketId;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', draggedTicketId);
      requestAnimationFrame(() => card.classList.add('dragging'));
    });
    container.addEventListener('dragend', e => {
      const card = e.target.closest('[data-ticket-id]');
      if (card) card.classList.remove('dragging');
      document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
      draggedTicketId = null;
    });
  });

  // Drop zones: the four .task-list divs + the backlog list
  const dropZones = [
    ...document.querySelectorAll('#kanban-active .task-list'),
    backlog,
  ];

  dropZones.forEach(zone => {
    zone.addEventListener('dragover', e => {
      if (!draggedTicketId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      zone.classList.add('drop-target');
    });

    zone.addEventListener('dragleave', e => {
      if (!zone.contains(e.relatedTarget)) zone.classList.remove('drop-target');
    });

    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drop-target');
      if (!draggedTicketId) return;

      // Derive column from zone
      const col    = zone.closest('.kanban-col');
      const column = col ? col.id.replace('col-', '') : 'backlog';

      // Skip if already in that column
      const ticket = state.tickets.find(t => t.id === draggedTicketId);
      if (!ticket || ticket.column === column) return;

      // Optimistic update
      ticket.column = column;
      renderKanban(state.tickets);

      fetch(`/api/kanban/tickets/${encodeURIComponent(draggedTicketId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ column }),
      })
        .then(r => r.json())
        .then(result => { if (result.error) console.warn('Drag failed:', result.error); })
        .catch(err => console.warn('Drag error:', err));
    });
  });
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
  document.getElementById('modal-comment-submit').addEventListener('click', postComment);
  document.getElementById('modal-comment-text').addEventListener('keydown', e => {
    if (e.key === 'Enter') postComment();
  });

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
  document.getElementById('modal-activity-section').hidden = true;

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
  document.getElementById('modal-activity-section').hidden = false;
  renderComments(ticket.comments ?? []);
  document.getElementById('modal-comment-text').value = '';

  currentEditId = id;
  document.getElementById('ticket-modal').hidden = false;
  document.getElementById('edit-title').focus();
}

function renderComments(comments) {
  const el = document.getElementById('modal-comments');
  if (!el) return;
  if (!comments.length) {
    el.innerHTML = '<p class="comments-empty">No activity yet.</p>';
    return;
  }
  el.innerHTML = comments.map(c => {
    const d = new Date(c.ts);
    const when = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `
      <div class="comment">
        <div class="comment-header">
          <span class="comment-author">${esc(c.author)}</span>
          <span class="comment-ts">${esc(when)}</span>
        </div>
        <div class="comment-text">${esc(c.text)}</div>
      </div>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
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

function postComment() {
  if (!currentEditId) return;
  const input = document.getElementById('modal-comment-text');
  const text  = input.value.trim();
  if (!text) return;

  const btn = document.getElementById('modal-comment-submit');
  btn.disabled = true;

  fetch(`/api/kanban/tickets/${encodeURIComponent(currentEditId)}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ author: 'human', text }),
  })
    .then(r => r.json())
    .then(result => {
      if (!result.error) {
        input.value = '';
        // Optimistically append the new comment
        const ticket = state.tickets.find(t => t.id === currentEditId);
        if (ticket) {
          ticket.comments = [...(ticket.comments ?? []), result];
          renderComments(ticket.comments);
        }
      }
    })
    .catch(() => {})
    .finally(() => { btn.disabled = false; });
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

// ── Speech / TTS ──────────────────────────────────────────────────────────────
//
// Flow:
//   1. When agent detail opens, send { type: 'set_speech_agent', name } over WS
//   2. Server synthesises via Piper + Rhubarb and sends back speech_chunk messages
//   3. Browser decodes base64 WAV, plays via Web Audio API
//   4. Audio clock drives avatarAPI.beginSpeech(visemes, getTime) for sync lipsync

let speechWs         = null;   // WebSocket to the same host
let audioCtx         = null;   // lazy AudioContext (requires user gesture first)
const speechQueues   = new Map(); // agentName → SpeechChunk[]
const speechPlaying  = new Set(); // agentName set — currently draining

function getSpeechWs() {
  if (speechWs && speechWs.readyState <= WebSocket.OPEN) return speechWs;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  speechWs = new WebSocket(`${proto}//${location.host}`);
  speechWs.onmessage = e => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'speech_chunk') handleSpeechChunk(msg.data);
    } catch { /* ignore */ }
  };
  speechWs.onerror = () => { speechWs = null; };
  speechWs.onclose = () => { speechWs = null; };
  return speechWs;
}

function setSpeechAgent(agentName) {
  const ws = getSpeechWs();
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'set_speech_agent', name: agentName ?? null }));
  } else {
    // Queue until open
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'set_speech_agent', name: agentName ?? null }));
    }, { once: true });
  }
}

function handleSpeechChunk(chunk) {
  if (chunk.agentName !== activeDetailAgent) return; // stale — ignore

  const q = speechQueues.get(chunk.agentName) ?? [];
  q.push(chunk);
  speechQueues.set(chunk.agentName, q);

  if (!speechPlaying.has(chunk.agentName)) drainSpeechQueue(chunk.agentName);
}

async function drainSpeechQueue(agentName) {
  speechPlaying.add(agentName);
  // Create AudioContext on the first user-driven call (drawer open = user gesture)
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') await audioCtx.resume();

  while (true) {
    const q = speechQueues.get(agentName) ?? [];
    if (q.length === 0 || agentName !== activeDetailAgent) break;
    const chunk = q.shift();
    try {
      await playSpeechChunk(chunk);
    } catch (err) {
      console.warn('[Speech] Playback error:', err);
    }
  }

  speechPlaying.delete(agentName);
  speechQueues.delete(agentName);
}

async function playSpeechChunk(chunk) {
  // Decode base64 → ArrayBuffer
  const binary = atob(chunk.audioBase64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const audioBuffer = await audioCtx.decodeAudioData(bytes.buffer);
  const source      = audioCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(audioCtx.destination);

  const startAt = audioCtx.currentTime;
  source.start();

  // Hand audio clock to the avatar for aligned lipsync
  window.avatarAPI?.beginSpeech(chunk.visemes, () => audioCtx.currentTime - startAt);

  return new Promise(resolve => {
    source.onended = () => {
      window.avatarAPI?.endSpeech();
      resolve();
    };
    // Safety fallback — resolve after duration + buffer
    setTimeout(() => { window.avatarAPI?.endSpeech(); resolve(); },
      (chunk.duration + 1.5) * 1000);
  });
}

function clearSpeechQueue(agentName) {
  speechQueues.delete(agentName);
  // endSpeech is called when the current chunk finishes
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
      if (msg.project) updateProjectBadge(msg.project.id, msg.project.dir);
      fetchTools();
      initTabs();
      initKanbanDrag();
      initTicketEditing();
      initCLI();
      initAgentDetail();
    } else if (msg.type === 'agent_update') {
      state.agents = msg.agents;
      renderAgents(state.agents);
    } else if (msg.type === 'scheduled_meetings_update') {
      renderCalendar(msg.meetings);
    } else if (msg.type === 'kanban_update') {
      state.tickets = msg.tickets;
      renderKanban(state.tickets);
      // Refresh comments in modal if it's open
      if (currentEditId) {
        const ticket = state.tickets.find(t => t.id === currentEditId);
        if (ticket) renderComments(ticket.comments ?? []);
      }
    } else if (msg.type === 'tools_update') {
      renderTools(msg.tools);
    } else if (msg.type === 'agent_stream') {
      appendAgentFeedEvent(msg.agent, msg.event);
    } else if (msg.type === 'cli_output') {
      appendCLIAgent(msg.from, msg.content, msg.kind);
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

// ── Agent detail drawer ───────────────────────────────────────────────────────

let activeDetailAgent = null;

// ── Provider / model catalogue (loaded once) ──────────────────────────────────

let _providersCache = null;

function loadProviders() {
  if (_providersCache) return Promise.resolve(_providersCache);
  return fetch('/api/providers')
    .then(r => r.json())
    .then(list => { _providersCache = list; return list; })
    .catch(() => []);
}

/**
 * Populate the provider <select> from the catalogue.
 * Only providers that have a backend implementation are shown.
 */
function populateProviderSelect(sel, providers, selectedId) {
  const IMPLEMENTED = ['anthropic', 'openai', 'gemini'];
  sel.innerHTML = '';
  for (const p of providers.filter(p => IMPLEMENTED.includes(p.id))) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.label;
    opt.selected = p.id === selectedId;
    sel.appendChild(opt);
  }
}

/**
 * Populate the model <select> with the model list for the given provider.
 * If the current model isn't in the list it is prepended so it remains selectable.
 */
function populateModelSelect(sel, providers, providerId, selectedModel) {
  const provider = providers.find(p => p.id === providerId);
  const models   = provider ? provider.models : [];
  sel.innerHTML  = '';

  // Ensure the currently-active model is always present, even if not in catalogue
  const list = models.includes(selectedModel) || !selectedModel
    ? models
    : [selectedModel, ...models];

  for (const m of list) {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    opt.selected = m === selectedModel;
    sel.appendChild(opt);
  }
}

let agentDetailInited = false;

function initAgentDetail() {
  if (agentDetailInited) return;
  agentDetailInited = true;

  document.getElementById('agents-container').addEventListener('click', e => {
    const card = e.target.closest('.agent-card');
    if (card) openAgentDetail(card.dataset.name);
  });
  document.getElementById('agent-detail-close').addEventListener('click', closeAgentDetail);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && activeDetailAgent) closeAgentDetail();
  });

  // Remove button
  document.getElementById('agent-remove-btn').addEventListener('click', () => {
    if (!activeDetailAgent) return;
    if (!confirm(`Remove agent "${activeDetailAgent}"? Their in-progress tickets will be returned to the backlog.`)) return;
    fetch(`/api/agents/${encodeURIComponent(activeDetailAgent)}`, { method: 'DELETE' })
      .then(r => r.json())
      .then(res => {
        if (res.error) { alert(res.error); return; }
        closeAgentDetail();
      });
  });

  // Avatar select — live preview + persist
  document.getElementById('agent-config-avatar').addEventListener('change', () => {
    if (!activeDetailAgent) return;
    const file = document.getElementById('agent-config-avatar').value;
    setAvatarOverride(activeDetailAgent, file);
    if (!file) { window.avatarAPI?.hide(); return; }
    getAvatars().then(avatars => {
      const av = avatars.find(a => a.file === file);
      if (av && window.avatarAPI) window.avatarAPI.show(av.file, av.camera);
    });
  });

  // Re-populate model list when provider changes
  document.getElementById('agent-config-provider').addEventListener('change', () => {
    const providerId = document.getElementById('agent-config-provider').value;
    loadProviders().then(providers => {
      const provider = providers.find(p => p.id === providerId);
      populateModelSelect(
        document.getElementById('agent-config-model'),
        providers,
        providerId,
        provider?.defaultModel ?? provider?.models?.[0] ?? '',
      );
    });
  });

  // Apply button — sends provider+model and hat change if needed
  document.getElementById('agent-config-apply').addEventListener('click', async () => {
    if (!activeDetailAgent) return;
    const btn = document.getElementById('agent-config-apply');
    btn.textContent = '…'; btn.disabled = true;
    try {
      const provider = document.getElementById('agent-config-provider').value;
      const model    = document.getElementById('agent-config-model').value;
      const hatType  = document.getElementById('agent-config-hat').value;
      const agent    = state.agents.find(a => a.name === activeDetailAgent);
      const tasks = [];
      if (model) tasks.push(fetch(`/api/agents/${encodeURIComponent(activeDetailAgent)}/config`, {
        method: 'PATCH', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ provider, model }),
      }));
      if (hatType && agent && hatType !== agent.hatType) tasks.push(
        fetch(`/api/agents/${encodeURIComponent(activeDetailAgent)}/hat`, {
          method: 'PATCH', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ hatType }),
        })
      );
      await Promise.all(tasks);
      btn.textContent = '✓';
    } catch {
      btn.textContent = '✗';
    }
    setTimeout(() => { btn.textContent = 'Apply'; btn.disabled = false; }, 1500);
  });
}

function openAgentDetail(name) {
  activeDetailAgent = name;
  const agent = state.agents.find(a => a.name === name);
  const c = agent ? hat(agent.hatType) : hat('white');

  document.getElementById('agent-detail-name').textContent = name;
  document.getElementById('agent-detail-name').style.color = c.label;
  document.getElementById('agent-detail-hat').textContent  = agent ? hatLabel(agent.hatType) : '';
  document.getElementById('agent-detail-hat').style.color  = c.label;
  const hatSel = document.getElementById('agent-config-hat');
  if (hatSel) hatSel.value = agent?.hatType || 'white';

  // Populate provider + model selects from the catalogue
  loadProviders().then(providers => {
    const providerId = (agent?.provider) || 'anthropic';
    const modelId    = (agent?.model)    || '';
    populateProviderSelect(document.getElementById('agent-config-provider'), providers, providerId);
    populateModelSelect(document.getElementById('agent-config-model'), providers, providerId, modelId);
  });

  const feed = document.getElementById('agent-detail-feed');
  feed.innerHTML = '<p class="feed-empty">Loading…</p>';
  document.getElementById('agent-detail').hidden = false;

  // Register interest in speech for this agent
  setSpeechAgent(name);

  // Populate avatar select and show current avatar
  getAvatars().then(avatars => {
    const avatarSel = document.getElementById('agent-config-avatar');
    avatarSel.innerHTML = '<option value="">(no avatar)</option>';
    for (const av of avatars) {
      const opt = document.createElement('option');
      opt.value = av.file;
      opt.textContent = av.name;
      avatarSel.appendChild(opt);
    }
    const current = findAvatarForAgent(name);
    avatarSel.value = current ? current.file : '';
    if (current && window.avatarAPI) {
      window.avatarAPI.show(current.file, current.camera);
    } else if (window.avatarAPI) {
      window.avatarAPI.hide();
    }
  });

  fetch(`/api/agents/${encodeURIComponent(name)}/feed`)
    .then(r => r.json())
    .then(events => {
      feed.innerHTML = '';
      if (!events.length) {
        feed.innerHTML = '<p class="feed-empty">No activity yet.</p>';
        return;
      }
      for (const ev of events) feed.appendChild(buildFeedItem(ev, name));
      feed.scrollTop = feed.scrollHeight;
    })
    .catch(() => { feed.innerHTML = '<p class="feed-empty">Failed to load.</p>'; });
}

function closeAgentDetail() {
  clearSpeechQueue(activeDetailAgent);
  setSpeechAgent(null);
  activeDetailAgent = null;
  document.getElementById('agent-detail').hidden = true;
  if (window.avatarAPI) window.avatarAPI.hide();
}

function appendAgentFeedEvent(agentName, ev) {
  if (activeDetailAgent !== agentName) return;
  const feed = document.getElementById('agent-detail-feed');
  const empty = feed.querySelector('.feed-empty');
  if (empty) empty.remove();
  feed.appendChild(buildFeedItem(ev, agentName));
  feed.scrollTop = feed.scrollHeight;

  // Trigger lipsync when the agent produces a response
  if (ev.type === 'agent_response' && ev.content && window.avatarAPI) {
    window.avatarAPI.speak(ev.content);
  }
}

function buildFeedItem(ev, selfName) {
  const el = document.createElement('div');
  const meta = FEED_META[ev.type] || { icon: '·', cls: 'feed-default', label: ev.type };
  el.className = 'feed-item feed-' + meta.cls;

  const d     = new Date(ev.ts || Date.now());
  const time  = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const label = feedLabel(ev, selfName, meta.label);
  const body  = feedBody(ev);

  el.innerHTML = `
    <div class="feed-item-header">
      <span class="feed-icon">${meta.icon}</span>
      <span class="feed-label">${esc(label)}</span>
      <span class="feed-time">${esc(time)}</span>
    </div>
    ${body ? `<div class="feed-body">${body}</div>` : ''}`;
  return el;
}

const FEED_META = {
  task_assigned:  { icon: '📋', cls: 'task',     label: 'Task assigned'   },
  task_complete:  { icon: '✓',  cls: 'complete',  label: 'Task complete'   },
  tool_call:      { icon: '⚙',  cls: 'tool',      label: 'Tool call'       },
  tool_result:    { icon: '↩',  cls: 'result',    label: 'Tool result'     },
  tool_error:     { icon: '✗',  cls: 'error',     label: 'Tool error'      },
  agent_response: { icon: '💬', cls: 'response',  label: 'Response'        },
  direct_message: { icon: '→',  cls: 'message',   label: 'Message'         },
  escalation:     { icon: '⚠',  cls: 'escalation',label: 'Escalation'      },
  human_message:  { icon: '👤', cls: 'human',     label: 'Human message'   },
  human_reply:    { icon: '👤', cls: 'human',     label: 'Human reply'     },
};

function feedLabel(ev, selfName, defaultLabel) {
  if (ev.type === 'direct_message') {
    return ev.from === selfName ? `→ ${ev.to}` : `← ${ev.from}`;
  }
  if (ev.type === 'task_assigned') {
    return ev.from === selfName ? `Delegated to ${ev.to}` : `Task from ${ev.from}`;
  }
  return defaultLabel;
}

function feedBody(ev) {
  switch (ev.type) {
    case 'task_assigned':
      return mdSafe(ev.task || ev.description || '');
    case 'task_complete':
      return mdSafe(ev.summary || '');
    case 'tool_call': {
      const args = ev.args ? JSON.stringify(ev.args, null, 2) : '';
      return `<span class="feed-tool-name">${esc(ev.tool)}</span>`
        + (args ? `<pre class="feed-pre">${esc(truncate(args, 300))}</pre>` : '');
    }
    case 'tool_result':
      return `<pre class="feed-pre">${esc(truncate(String(ev.result ?? ''), 400))}</pre>`;
    case 'tool_error':
      return `<span class="feed-err">${esc(ev.error || '')}</span>`;
    case 'agent_response':
      return mdSafe(ev.content || '');
    case 'direct_message':
      return mdSafe(ev.content || '');
    case 'escalation':
      return mdSafe(ev.message || '');
    case 'human_message':
    case 'human_reply':
      return mdSafe(ev.content || '');
    default:
      return '';
  }
}

function mdSafe(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.className = 'feed-md';
  if (window.marked) div.innerHTML = window.marked.parse(text);
  else               div.textContent = text;
  return div.outerHTML;
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// ── CLI tab ───────────────────────────────────────────────────────────────────

let cliInited = false;

function initCLI() {
  if (cliInited) return;
  cliInited = true;

  const input = document.getElementById('cli-input');
  if (!input) return;

  appendCLILine('Team CLI — type "help" for commands', 'cli-system');

  input.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const line = input.value.trim();
    if (!line) return;
    input.value = '';
    appendCLILine('> ' + line, 'cli-input-echo');

    fetch('/api/cli', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line }),
    })
      .then(r => r.json())
      .then(data => { if (data.output) appendCLILine(data.output, 'cli-response'); })
      .catch(err => appendCLILine('Error: ' + err, 'cli-error'));
  });
}

function appendCLILine(text, cls) {
  const out = document.getElementById('cli-output');
  if (!out) return;
  const el = document.createElement('div');
  el.className = 'cli-line ' + (cls || '');
  el.textContent = text;
  out.appendChild(el);
  out.scrollTop = out.scrollHeight;
}

function appendCLIAgent(from, content, kind) {
  const out = document.getElementById('cli-output');
  if (!out) return;

  const wrap = document.createElement('div');
  wrap.className = 'cli-agent-block' + (kind === 'escalation' ? ' cli-agent-block--escalation' : '');

  const header = document.createElement('div');
  header.className = 'cli-agent-header';
  header.textContent = (kind === 'escalation' ? '⚠ ESCALATION — ' : '') + from;

  const body = document.createElement('div');
  body.className = 'cli-agent-body';
  if (window.marked) {
    body.innerHTML = window.marked.parse(content ?? '');
  } else {
    body.textContent = content ?? '';
  }

  wrap.appendChild(header);
  wrap.appendChild(body);
  out.appendChild(wrap);
  out.scrollTop = out.scrollHeight;
}

// ── Tab switching ─────────────────────────────────────────────────────────────

function initTabs() {
  document.querySelectorAll('.panel-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.panel-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === tab + '-content'));
      if (tab === 'mcp') fetchMCPCatalogue();
      if (tab === 'cli') document.getElementById('cli-input')?.focus();
    });
  });
}

// ── Debug logging toggle ──────────────────────────────────────────────────────

function initDebugButton() {
  const btn = document.getElementById('debug-log-btn');
  if (!btn) return;

  // Sync with server state on load
  fetch('/api/debug/logging')
    .then(r => r.json())
    .then(({ logPrompts }) => setDebugBtn(btn, logPrompts))
    .catch(() => {});

  btn.addEventListener('click', () => {
    const next = !btn.classList.contains('active');
    fetch('/api/debug/logging', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    })
      .then(r => r.json())
      .then(({ logPrompts }) => setDebugBtn(btn, logPrompts))
      .catch(() => {});
  });
}

function setDebugBtn(btn, on) {
  btn.classList.toggle('active', on);
  btn.title = on ? 'Prompt logging ON — click to disable' : 'Toggle prompt logging to console';
}

// ── Settings modal ────────────────────────────────────────────────────────────

const ENV_META = {
  ANTHROPIC_API_KEY: { label: 'Anthropic API Key',        group: 'API Keys', secret: true,  hint: 'sk-ant-…'             },
  OPENAI_API_KEY:    { label: 'OpenAI API Key',            group: 'API Keys', secret: true,  hint: 'sk-proj-…'            },
  GEMINI_API_KEY:    { label: 'Google Gemini API Key',     group: 'API Keys', secret: true,  hint: 'AIzaSy…'              },
  BRAVE_API_KEY:     { label: 'Brave Search API Key',      group: 'API Keys', secret: true,  hint: ''                     },
  ANTHROPIC_MODEL:   { label: 'Anthropic Default Model',   group: 'Models',   secret: false, hint: 'claude-haiku-4-5-20251001' },
  OPENAI_MODEL:      { label: 'OpenAI Default Model',      group: 'Models',   secret: false, hint: 'gpt-4.1-mini'              },
  GEMINI_MODEL:      { label: 'Gemini Default Model',      group: 'Models',   secret: false, hint: 'gemini-2.5-flash'           },
};

const GROUP_ORDER = ['API Keys', 'Models', 'Other'];

function initSettings() {
  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('settings-close').addEventListener('click', closeSettings);
  document.getElementById('settings-cancel').addEventListener('click', closeSettings);
  document.getElementById('settings-save').addEventListener('click', saveSettings);
  document.getElementById('settings-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('settings-modal')) closeSettings();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !document.getElementById('settings-modal').hidden) closeSettings();
  });
}

function openSettings() {
  const modal = document.getElementById('settings-modal');
  const body  = document.getElementById('settings-body');
  const msg   = document.getElementById('settings-msg');
  msg.textContent = '';
  msg.className = 'settings-msg';
  body.innerHTML = '<p class="settings-loading">Loading…</p>';
  modal.hidden = false;

  Promise.all([
    fetch('/api/env').then(r => r.json()),
    fetch('/api/providers').then(r => r.json()),
  ])
    .then(([entries, providers]) => renderSettingsBody(entries, providers))
    .catch(() => { body.innerHTML = '<p class="settings-loading">Failed to load settings.</p>'; });
}

function renderSettingsBody(entries, providers) {
  const body = document.getElementById('settings-body');

  // Group entries
  const grouped = {};
  for (const entry of entries) {
    const meta = ENV_META[entry.key];
    const group = meta ? meta.group : 'Other';
    if (!grouped[group]) grouped[group] = [];
    grouped[group].push({ ...entry, meta });
  }

  // Add any ENV_META keys not in the file
  for (const [key, meta] of Object.entries(ENV_META)) {
    const group = meta.group;
    if (!grouped[group]) grouped[group] = [];
    if (!grouped[group].some(e => e.key === key)) {
      grouped[group].push({ key, value: '', isSecret: meta.secret, meta });
    }
  }

  let html = '';
  for (const group of GROUP_ORDER) {
    const items = grouped[group];
    if (!items || items.length === 0) continue;
    html += `<div class="settings-section"><div class="settings-section-title">${esc(group)}</div>`;
    for (const item of items) {
      const label = item.meta ? item.meta.label : item.key;
      const hint  = item.meta?.hint || '';
      const inputId = `env-field-${item.key}`;
      if (item.isSecret) {
        html += `
          <div class="env-field">
            <label class="env-label" for="${inputId}">${esc(label)}</label>
            <div class="env-secret-wrap">
              <input type="password" id="${inputId}" class="env-input" data-key="${esc(item.key)}"
                     value="${esc(item.value)}" placeholder="${esc(hint)}" autocomplete="off" spellcheck="false">
              <button class="env-eye" type="button" data-for="${inputId}" title="Show/hide value">
                <span class="eye-icon">👁</span>
              </button>
            </div>
          </div>`;
      } else {
        html += `
          <div class="env-field">
            <label class="env-label" for="${inputId}">${esc(label)}</label>
            <input type="text" id="${inputId}" class="env-input" data-key="${esc(item.key)}"
                   value="${esc(item.value)}" placeholder="${esc(hint)}" autocomplete="off" spellcheck="false">
          </div>`;
      }
    }
    html += '</div>';
  }

  // Provider status
  if (providers && providers.length) {
    html += `<div class="settings-section"><div class="settings-section-title">Provider Status</div>`;
    for (const p of providers) {
      const dot = p.available ? '🟢' : '🔴';
      const modelNote = p.available ? ` · model: ${esc(p.defaultModel ?? '')}` : ' · no API key set';
      html += `<div class="provider-status-row"><span>${dot} ${esc(p.label)}</span><span class="provider-status-note">${modelNote}</span></div>`;
    }
    html += '</div>';
  }

  body.innerHTML = html;

  // Wire eye buttons
  body.querySelectorAll('.env-eye').forEach(btn => {
    btn.addEventListener('click', () => {
      const inp = document.getElementById(btn.dataset.for);
      if (!inp) return;
      inp.type = inp.type === 'password' ? 'text' : 'password';
      btn.querySelector('.eye-icon').textContent = inp.type === 'password' ? '👁' : '🙈';
    });
  });
}

function closeSettings() {
  document.getElementById('settings-modal').hidden = true;
}

function saveSettings() {
  const inputs = document.getElementById('settings-body').querySelectorAll('.env-input[data-key]');
  const updates = {};
  inputs.forEach(inp => { updates[inp.dataset.key] = inp.value; });

  const saveBtn = document.getElementById('settings-save');
  const msg     = document.getElementById('settings-msg');
  saveBtn.disabled = true;
  msg.textContent = '';

  fetch('/api/env', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
    .then(r => r.json())
    .then(res => {
      if (res.error) {
        msg.textContent = res.error;
        msg.className = 'settings-msg settings-msg--error';
      } else {
        msg.textContent = 'Saved.';
        msg.className = 'settings-msg settings-msg--ok';
        setTimeout(closeSettings, 800);
      }
    })
    .catch(err => {
      msg.textContent = 'Save failed.';
      msg.className = 'settings-msg settings-msg--error';
    })
    .finally(() => { saveBtn.disabled = false; });
}

// ── Project switcher ──────────────────────────────────────────────────────────

function updateProjectBadge(id, dir) {
  const badge = document.getElementById('project-badge');
  if (badge) { badge.textContent = id; badge.title = dir ?? id; }
}

function initProjectBadge() {
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

function loadProjectList() {
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
      for (const p of projects) {
        const row = document.createElement('div');
        row.className = 'project-switcher-row' + (p.active ? ' active' : '');
        row.textContent = p.id;
        row.title = p.dir;
        if (!p.active) {
          row.addEventListener('click', () => doSwitchProject(p.id));
        }
        list.appendChild(row);
      }
    })
    .catch(() => { list.innerHTML = '<div class="project-switcher-loading">Failed to load.</div>'; });
}

function doSwitchProject(id) {
  const switcher = document.getElementById('project-switcher');
  const badge    = document.getElementById('project-badge');
  switcher.hidden = true;
  const prevId = badge.textContent;
  badge.textContent = '…';

  fetch('/api/project/switch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
    .then(r => r.json())
    .then(res => {
      if (res.error) {
        badge.textContent = prevId;
        console.error('Project switch failed:', res.error);
      }
      // Server broadcasts 'init' SSE which will re-render everything and update the badge
    })
    .catch(() => { badge.textContent = prevId; });
}

// ── Add Agent modal ───────────────────────────────────────────────────────────

function initAddAgent() {
  document.getElementById('add-agent-btn').addEventListener('click', openAddAgent);
  document.getElementById('add-agent-close').addEventListener('click', closeAddAgent);
  document.getElementById('add-agent-cancel').addEventListener('click', closeAddAgent);
  document.getElementById('add-agent-save').addEventListener('click', saveAddAgent);

  // Populate provider select and re-populate models when provider changes
  loadProviders().then(providers => {
    populateProviderSelect(document.getElementById('add-agent-provider'), providers, 'anthropic');
    const p = providers.find(p => p.id === 'anthropic');
    populateModelSelect(document.getElementById('add-agent-model'), providers, 'anthropic', p?.defaultModel ?? '');
  });
  document.getElementById('add-agent-provider').addEventListener('change', () => {
    const pid = document.getElementById('add-agent-provider').value;
    loadProviders().then(providers => {
      const p = providers.find(p => p.id === pid);
      populateModelSelect(document.getElementById('add-agent-model'), providers, pid, p?.defaultModel ?? '');
    });
  });

  // Close on overlay click
  document.getElementById('add-agent-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeAddAgent();
  });
}

function openAddAgent() {
  document.getElementById('add-agent-name').value = '';
  document.getElementById('add-agent-specialisation').value = '';
  document.getElementById('add-agent-error').textContent = '';
  document.getElementById('add-agent-modal').hidden = false;
  document.getElementById('add-agent-name').focus();
}

function closeAddAgent() {
  document.getElementById('add-agent-modal').hidden = true;
}

async function saveAddAgent() {
  const name = document.getElementById('add-agent-name').value.trim();
  const hatType = document.getElementById('add-agent-hat').value;
  const specialisation = document.getElementById('add-agent-specialisation').value.trim();
  const provider = document.getElementById('add-agent-provider').value;
  const model = document.getElementById('add-agent-model').value;
  const errEl = document.getElementById('add-agent-error');
  errEl.textContent = '';
  if (!name) { errEl.textContent = 'Name is required.'; return; }
  const btn = document.getElementById('add-agent-save');
  btn.disabled = true; btn.textContent = 'Adding…';
  try {
    const res = await fetch('/api/agents', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ name, hatType, specialisation: specialisation || undefined, provider, model }),
    }).then(r => r.json());
    if (res.error) { errEl.textContent = res.error; }
    else { closeAddAgent(); }
  } catch { errEl.textContent = 'Failed to add agent.'; }
  btn.disabled = false; btn.textContent = 'Add Agent';
}

// ── Backlog / Calendar panel tabs ─────────────────────────────────────────────

function initBacklogCalendarTabs() {
  document.querySelectorAll('.backlog-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.btab;
      document.querySelectorAll('.backlog-tab').forEach(b => b.classList.toggle('active', b.dataset.btab === tab));
      document.getElementById('backlog-list').classList.toggle('active', tab === 'backlog');
      document.getElementById('backlog-list').hidden = tab !== 'backlog';
      document.getElementById('calendar-pane').classList.toggle('active', tab === 'calendar');
      document.getElementById('calendar-pane').hidden = tab !== 'calendar';
      document.getElementById('cal-nav').hidden = tab !== 'calendar';
      document.getElementById('cal-view-tabs').hidden = tab !== 'calendar';
      document.getElementById('new-meeting-btn').hidden = tab !== 'calendar';
      if (tab === 'calendar') fetchCalendar();
    });
  });
}

// ── Calendar / Scheduled Meetings ────────────────────────────────────────────

const MEETING_TYPE_LABEL = {
  standup:         'Standup',
  sprint_planning: 'Sprint Planning',
  retro:           'Retro',
  review:          'Review',
  ad_hoc:          'Ad Hoc',
};

// Calendar state
let calMeetings = [];
let calView = 'week';    // 'week' | 'day' | 'agenda'
let calOffset = 0;       // weeks or days offset from today

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function fetchCalendar() {
  try {
    calMeetings = await fetch('/api/scheduled-meetings').then(r => r.json());
  } catch { calMeetings = []; }
  renderCalendarView();
}

function renderCalendar(meetings) {
  calMeetings = meetings ?? [];
  renderCalendarView();
}

function renderCalendarView() {
  updateCalNav();
  if (calView === 'week')   renderWeekView();
  else if (calView === 'day') renderDayView();
  else                        renderAgendaView();
}

// ── Navigation label ──────────────────────────────────────────────────────────

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
  const dow = today.getDay(); // 0=Sun
  const mon = new Date(today);
  mon.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1) + offset * 7);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return { start: mon, end: sun };
}

// ── Grid helpers ──────────────────────────────────────────────────────────────

const CAL_START_HOUR = 7;   // 7am
const CAL_END_HOUR   = 21;  // 9pm
const CAL_HOUR_PX    = 52;  // pixels per hour

function buildGridHTML(days) {
  const totalH = (CAL_END_HOUR - CAL_START_HOUR) * CAL_HOUR_PX;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Header
  const headCols = days.map(d => {
    const isToday = d.getTime() === today.getTime();
    const label = d.toLocaleString(undefined, { weekday: 'short', day: 'numeric' });
    return `<div class="cal-head-cell${isToday ? ' today' : ''}">${escHtml(label)}</div>`;
  }).join('');

  // Time labels
  let timeLabels = '';
  for (let h = CAL_START_HOUR; h <= CAL_END_HOUR; h++) {
    const top = (h - CAL_START_HOUR) * CAL_HOUR_PX;
    const label = h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`;
    timeLabels += `<div class="cal-time-label" style="top:${top}px">${label}</div>`;
  }

  // Hour lines per day
  let hourLines = '';
  for (let h = CAL_START_HOUR; h <= CAL_END_HOUR; h++) {
    const top = (h - CAL_START_HOUR) * CAL_HOUR_PX;
    hourLines += `<div class="cal-hour-line" style="top:${top}px"></div>`;
  }

  const dayCols = days.map((d, i) => {
    const events = calMeetingsOnDay(d).map(m => buildEventHTML(m)).join('');
    return `<div class="cal-day-col" data-day="${i}">${hourLines}${events}</div>`;
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
  const when = new Date(m.scheduledFor);
  const startMin = (when.getHours() - CAL_START_HOUR) * 60 + when.getMinutes();
  const durationMin = 60; // default 1 hour
  const top  = Math.max(0, (startMin / 60) * CAL_HOUR_PX);
  const height = Math.max(20, (durationMin / 60) * CAL_HOUR_PX - 2);
  const timeStr = when.toLocaleString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `<div class="cal-event cal-event--${m.status}" style="top:${top}px;height:${height}px"
    title="${escHtml(m.topic)}" onclick="showMeetingPopup('${m.id}')">
    <div class="cal-event-time">${escHtml(timeStr)}</div>
    <div class="cal-event-title">${escHtml(m.topic)}</div>
  </div>`;
}

function calMeetingsOnDay(d) {
  const dayStr = d.toISOString().slice(0, 10);
  return calMeetings.filter(m => m.scheduledFor.slice(0, 10) === dayStr);
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
  // Scroll to current hour
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
  const today = new Date(); today.setHours(0, 0, 0, 0);

  // Group by date
  const groups = new Map();
  for (const m of sorted) {
    const key = m.scheduledFor.slice(0, 10);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }

  let html = '<div class="cal-agenda">';
  for (const [key, meetings] of groups) {
    const d = new Date(key + 'T00:00:00');
    const isToday = d.getTime() === today.getTime();
    const isTomorrow = d.getTime() === today.getTime() + 86400000;
    let label;
    if (isToday) label = 'Today';
    else if (isTomorrow) label = 'Tomorrow';
    else label = d.toLocaleString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

    html += `<div class="cal-date-group">
      <div class="cal-date-header${isToday ? ' today' : ''}">${escHtml(label)}</div>`;
    for (const m of meetings) {
      html += buildAgendaItemHTML(m);
    }
    html += '</div>';
  }
  html += '</div>';
  pane.innerHTML = html;
}

function buildAgendaItemHTML(m) {
  const when = new Date(m.scheduledFor);
  const timeStr = when.toLocaleString(undefined, { hour: 'numeric', minute: '2-digit' });
  const parts = [m.facilitator, ...(m.participants || [])];
  const people = [...new Set(parts)].join(', ');
  const actions = m.status === 'scheduled'
    ? `<div class="calendar-item-actions">
        <button class="calendar-item-btn" onclick="launchMeetingNow('${m.id}')">Launch now</button>
        <button class="calendar-item-btn calendar-item-btn--danger" onclick="cancelMeeting('${m.id}')">Cancel</button>
       </div>`
    : '';
  return `<div class="calendar-item calendar-item--${m.status}">
    <div class="calendar-item-header">
      <span class="calendar-item-time">${escHtml(timeStr)}</span>
      <span class="calendar-item-type">${escHtml(MEETING_TYPE_LABEL[m.type] ?? m.type)}</span>
      <span class="calendar-item-topic">${escHtml(m.topic)}</span>
    </div>
    <div class="calendar-item-meta">${escHtml(people)}</div>
    ${m.agenda ? `<div class="calendar-item-meta">${escHtml(m.agenda.slice(0, 100))}</div>` : ''}
    ${actions}
  </div>`;
}

// ── Meeting popup (click on grid event) ───────────────────────────────────────

function showMeetingPopup(id) {
  const m = calMeetings.find(x => x.id === id);
  if (!m) return;
  const when = new Date(m.scheduledFor).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const parts = [m.facilitator, ...(m.participants || [])];
  const people = [...new Set(parts)].join(', ');
  let msg = `${m.topic}\n${when}\n${people}`;
  if (m.agenda) msg += `\n\nAgenda: ${m.agenda}`;
  if (m.status === 'scheduled' && confirm(`${msg}\n\nLaunch this meeting now?`)) {
    launchMeetingNow(id);
  }
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function launchMeetingNow(id) {
  try {
    const res = await fetch(`/api/scheduled-meetings/${id}/launch`, { method: 'POST' }).then(r => r.json());
    if (res.error) alert(res.error);
    else fetchCalendar();
  } catch { alert('Failed to launch meeting.'); }
}

async function cancelMeeting(id) {
  if (!confirm('Cancel this meeting?')) return;
  try {
    const res = await fetch(`/api/scheduled-meetings/${id}/cancel`, { method: 'POST' }).then(r => r.json());
    if (res.error) alert(res.error);
    else fetchCalendar();
  } catch { alert('Failed to cancel meeting.'); }
}

// ── Init ──────────────────────────────────────────────────────────────────────

function initCalendar() {
  // View switcher
  document.querySelectorAll('.cal-view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      calView = btn.dataset.view;
      calOffset = 0;
      document.querySelectorAll('.cal-view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === calView));
      const agendaMode = calView === 'agenda';
      document.getElementById('cal-nav').hidden = agendaMode;
      renderCalendarView();
    });
  });

  // Prev / Next
  document.getElementById('cal-prev')?.addEventListener('click', () => { calOffset--; renderCalendarView(); });
  document.getElementById('cal-next')?.addEventListener('click', () => { calOffset++; renderCalendarView(); });

  // New meeting button & modal
  document.getElementById('new-meeting-btn')?.addEventListener('click', openNewMeeting);
  document.getElementById('new-meeting-close')?.addEventListener('click', closeNewMeeting);
  document.getElementById('new-meeting-cancel')?.addEventListener('click', closeNewMeeting);
  document.getElementById('new-meeting-save')?.addEventListener('click', saveNewMeeting);
  document.getElementById('new-meeting-modal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeNewMeeting();
  });
}

function openNewMeeting() {
  const modal = document.getElementById('new-meeting-modal');
  const dt = new Date(Date.now() + 3600_000);
  dt.setSeconds(0, 0);
  document.getElementById('meeting-datetime').value = dt.toISOString().slice(0, 16);
  document.getElementById('meeting-topic').value = '';
  document.getElementById('meeting-agenda').value = '';
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
  const errEl = document.getElementById('new-meeting-error');
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

initProjectBadge();
initDebugButton();
initSettings();
initAddAgent();
initCalendar();
initBacklogCalendarTabs();
connect();
