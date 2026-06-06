// ── Constants ────────────────────────────────────────────────────────────────

const HAT = {
  none:   { bar: '#30363d', label: '#6e7681', bg: 'rgba(48,54,61,0.20)'   },
  white:  { bar: '#e6edf3', label: '#0d1117', bg: 'rgba(230,237,243,0.40)' },
  red:    { bar: '#f85149', label: '#f85149', bg: 'rgba(248,81,73,0.12)'   },
  black:  { bar: '#8b949e', label: '#8b949e', bg: 'rgba(139,148,158,0.12)' },
  yellow: { bar: '#e3b341', label: '#e3b341', bg: 'rgba(227,179,65,0.12)'  },
  green:  { bar: '#3fb950', label: '#3fb950', bg: 'rgba(63,185,80,0.12)'   },
  blue:   { bar: '#58a6ff', label: '#58a6ff', bg: 'rgba(88,166,255,0.12)'  },
};

const HAT_OPTIONS = [
  { value: 'none',   label: 'No Hat'             },
  { value: 'white',  label: 'White — Facts'      },
  { value: 'red',    label: 'Red — Emotion'      },
  { value: 'black',  label: 'Black — Caution'    },
  { value: 'yellow', label: 'Yellow — Optimism'  },
  { value: 'green',  label: 'Green — Creativity' },
  { value: 'blue',   label: 'Blue — Process'     },
];

const HAT_DESC = {
  none:   'No Hat',
  white:  'Facts',
  yellow: 'Optimism',
  black:  'Caution',
  red:    'Emotion',
  green:  'Creativity',
  blue:   'Process',
};

function hatLabel(type) {
  const types = Array.isArray(type) ? type : [type];
  const real = types.filter(t => t && t !== 'none');
  if (real.length === 0) return 'No Hat';
  if (real.length === 1) {
    const desc = HAT_DESC[real[0]];
    return desc ? `${real[0]} hat — ${desc}` : `${real[0]} hat`;
  }
  return real.map(t => t + ' hat').join(' + ');
}

function hat(type) {
  const types = Array.isArray(type) ? type : [type ?? 'none'];
  const real = types.filter(t => t && t !== 'none');
  if (real.length === 0) return HAT.none;
  if (real.length === 1) return HAT[real[0]] ?? HAT.white;
  const bars = real.map(t => HAT[t]?.bar ?? '#888');
  return {
    bar: `linear-gradient(135deg, ${bars.join(', ')})`,
    label: HAT[real[0]]?.label ?? HAT.white.label,
    bg: HAT[real[0]]?.bg ?? HAT.white.bg,
  };
}

function populateHatGroup(containerId, selectedHats) {
  const group = document.getElementById(containerId);
  if (!group) return;
  const selected = new Set(Array.isArray(selectedHats) ? selectedHats : [selectedHats ?? 'none']);
  group.innerHTML = '';
  for (const h of HAT_OPTIONS) {
    const lbl = document.createElement('label');
    lbl.className = 'hat-check-item';
    const inp = document.createElement('input');
    inp.type = 'checkbox';
    inp.value = h.value;
    inp.checked = selected.has(h.value);
    const dot = document.createElement('span');
    dot.className = 'hat-check-dot';
    dot.style.background = HAT[h.value]?.bar ?? '#888';
    const txt = document.createElement('span');
    txt.className = 'hat-check-label';
    txt.textContent = h.label;
    lbl.append(inp, dot, txt);
    lbl.classList.toggle('hat-check-item--on', inp.checked);
    inp.addEventListener('change', () => lbl.classList.toggle('hat-check-item--on', inp.checked));
    group.appendChild(lbl);
  }
}

function getSelectedHats(containerId) {
  const checks = document.querySelectorAll(`#${containerId} input[type=checkbox]:checked`);
  const vals = Array.from(checks).map(c => c.value);
  return vals.length ? vals : ['none'];
}

const STATE_LABEL = {
  idle:             'Idle',
  working:          'Working',
  waiting_for_help: 'Waiting for help',
  in_discussion:    'In discussion',
};


// ── Specialisation helpers ────────────────────────────────────────────────────

let specOptions = []; // populated from /api/specialisations on init

async function loadSpecialisations() {
  try {
    const res = await fetch('/api/specialisations');
    const data = await res.json();
    specOptions = data.specialisations || [];
  } catch { specOptions = []; }
  populateSpecSelects();
}

function populateSpecSelects() {
  for (const id of ['add-agent-specialisation']) {
    const sel = document.getElementById(id);
    if (!sel) continue;
    const current = sel.value;
    // Keep blank + options + custom
    sel.innerHTML = '<option value="">— none —</option>';
    for (const s of specOptions) {
      const opt = document.createElement('option');
      opt.value = s; opt.textContent = s;
      sel.appendChild(opt);
    }
    const custom = document.createElement('option');
    custom.value = '__custom__'; custom.textContent = 'Custom…';
    sel.appendChild(custom);
    // Restore previous value if still valid
    if (current) sel.value = current;
  }
}

function getSpecValue(selectId, customId) {
  const sel = document.getElementById(selectId);
  if (!sel) return '';
  if (sel.value === '__custom__') return document.getElementById(customId)?.value.trim() || '';
  return sel.value;
}

function setSpecValue(selectId, customId, value) {
  const sel  = document.getElementById(selectId);
  const cust = document.getElementById(customId);
  if (!sel) return;
  if (!value) {
    sel.value = '';
    if (cust) { cust.value = ''; cust.hidden = true; }
  } else if (specOptions.includes(value)) {
    sel.value = value;
    if (cust) { cust.value = ''; cust.hidden = true; }
  } else {
    sel.value = '__custom__';
    if (cust) { cust.value = value; cust.hidden = false; }
  }
}

// ── Personas ──────────────────────────────────────────────────────────────────

let personasByHat = {};

async function loadPersonas() {
  try {
    const res = await fetch('/api/personas');
    personasByHat = await res.json();
  } catch { personasByHat = {}; }
}

function populatePersonaSelect(selectId, hatType, currentName) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  sel.innerHTML = '<option value="">— custom —</option>';
  const pool = personasByHat[hatType] ?? [];
  for (const p of pool) {
    const opt = document.createElement('option');
    opt.value = p.name; opt.textContent = p.name;
    sel.appendChild(opt);
  }
  sel.value = (currentName && pool.some(p => p.name === currentName)) ? currentName : '';
}

// ── State ─────────────────────────────────────────────────────────────────────

let state = { agents: [], tickets: [], humanName: 'human' };

// ── Agent config cache ────────────────────────────────────────────────────────
// Tracks hat, voice, avatar per agent so dropdowns can show usage by others.

const agentConfigs = new Map(); // name → { hatType, voice, avatar, background }

function syncAgentConfigs() {
  const voiceOverrides  = getVoiceOverrides();
  const avatarOverrides = getAvatarOverrides();
  for (const agent of state.agents) {
    // Prefer server-side values; fall back to localStorage for backwards compat
    const avatar     = agent.avatar      ?? avatarOverrides[agent.name] ?? null;
    const voice      = agent.voice       ?? voiceOverrides[agent.name]  ?? null;
    const background = agent.background  ?? null;
    agentConfigs.set(agent.name, { hatType: agent.hatType, voice, avatar, background });
    // Keep localStorage in sync so avatar.js / voice preview still work
    if (agent.avatar)      setAvatarOverride(agent.name, agent.avatar);
    if (agent.voice)       setVoiceOverride(agent.name, agent.voice);
    if (agent.speakerName) setSpeakerOverride(agent.name, agent.speakerName);
  }
  // Remove stale entries
  for (const name of agentConfigs.keys()) {
    if (!state.agents.find(a => a.name === name)) agentConfigs.delete(name);
  }
}

/** Count how many agents OTHER than `excludeName` have field === value. */
function usageCount(field, value, excludeName) {
  if (!value) return 0;
  let n = 0;
  for (const [name, cfg] of agentConfigs) {
    if (name !== excludeName && cfg[field] === value) n++;
  }
  return n;
}

/** Return names of agents OTHER than `excludeName` that have field === value. */
function usersOf(field, value, excludeName) {
  if (!value) return [];
  const names = [];
  for (const [name, cfg] of agentConfigs) {
    if (name !== excludeName && cfg[field] === value) names.push(name);
  }
  return names;
}

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

// ── Background catalogue ───────────────────────────────────────────────────────

let backgroundList = null; // cached filenames from /api/images/backgrounds

async function getBackgrounds(forceRefresh = false) {
  if (backgroundList && !forceRefresh) return backgroundList;
  try {
    const res = await fetch('/api/images/backgrounds');
    const data = await res.json();
    backgroundList = data.backgrounds || [];
  } catch {
    backgroundList = [];
  }
  return backgroundList;
}

function applyAvatarBackground(filename) {
  const panel = document.getElementById('avatar-panel');
  if (!panel) return;
  if (filename) {
    panel.style.backgroundImage = `url('/backgrounds/${encodeURIComponent(filename)}')`;
    panel.style.backgroundSize  = 'cover';
    panel.style.backgroundPosition = 'center';
  } else {
    panel.style.backgroundImage = '';
  }
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

// hat() is defined above near hatLabel()

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
      <button class="agent-card-chat-btn" title="Chat with this agent">💬</button>
      <div class="agent-hat-icon"></div>
    </div>
    <div class="agent-state">
      <div class="state-dot"></div>
      <span class="state-label"></span>
    </div>
    <div class="agent-meta"></div>
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
  el.querySelector('.agent-hat-icon').style.backgroundColor = c.bar;

  const badge = el.querySelector('.agent-hat-badge');
  badge.textContent = hatLabel(agent.hatType);
  badge.style.color = c.label;
  badge.style.background = c.bg;

  const dot = el.querySelector('.state-dot');
  dot.className = 'state-dot ' + agent.state;
  el.querySelector('.state-label').textContent = STATE_LABEL[agent.state] || agent.state;

  el.querySelector('.agent-activity-text').textContent = agent.activity || '';

  // Spec + model meta line
  const metaEl = el.querySelector('.agent-meta');
  if (metaEl) {
    const parts = [];
    if (agent.specialisation) parts.push(agent.specialisation);
    if (agent.model)          parts.push(agent.model);
    metaEl.textContent = parts.join(' · ');
    metaEl.hidden = parts.length === 0;
  }

  // Talking-to line
  let talkEl = el.querySelector('.agent-talking-to');
  if (agent.talkingTo) {
    if (!talkEl) {
      talkEl = document.createElement('div');
      talkEl.className = 'agent-talking-to';
      el.querySelector('.agent-activity-text').appendChild(talkEl);
    }
    talkEl.textContent = '↔ ' + agent.talkingTo;
    el.classList.add('communicating');
  } else {
    if (talkEl) talkEl.remove();
    el.classList.remove('communicating');
  }

  // Cost-idle badge
  let costEl = el.querySelector('.agent-cost-idle');
  if (agent.costIdled) {
    if (!costEl) {
      costEl = document.createElement('div');
      costEl.className = 'agent-cost-idle';
      el.querySelector('.agent-activity').appendChild(costEl);
    }
    const spent = agent.hourlyCost != null ? `$${agent.hourlyCost.toFixed(3)}/hr` : '';
    costEl.textContent = `Cost limit reached (${spent}) — waiting for next hour`;
  } else if (agent.maxCostPerHour && agent.hourlyCost != null && agent.hourlyCost > 0) {
    if (!costEl) {
      costEl = document.createElement('div');
      costEl.className = 'agent-cost-idle';
      el.querySelector('.agent-activity').appendChild(costEl);
    }
    costEl.textContent = `$${agent.hourlyCost.toFixed(3)} / $${agent.maxCostPerHour}/hr`;
  } else {
    if (costEl) costEl.remove();
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
    line.setAttribute('stroke-width', '5');
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
const ACTIVE_COLUMNS = ['ready', 'in_progress', 'blocked', 'review', 'closed'];

let kanbanFilterUser = '';
let kanbanFilterTag  = '';

function populateKanbanFilters(tickets) {
  const users = [...new Set(tickets.map(t => t.assignee).filter(Boolean))].sort();
  const tags  = [...new Set(tickets.flatMap(t => t.tags ?? []))].sort();

  const userSel = document.getElementById('kanban-filter-user');
  const tagSel  = document.getElementById('kanban-filter-tag');
  if (!userSel || !tagSel) return;

  const prevUser = userSel.value;
  const prevTag  = tagSel.value;

  userSel.innerHTML = '<option value="">All users</option>' +
    users.map(u => `<option value="${esc(u)}"${u === prevUser ? ' selected' : ''}>${esc(u)}</option>`).join('');
  tagSel.innerHTML  = '<option value="">All tags</option>' +
    tags.map(t => `<option value="${esc(t)}"${t === prevTag ? ' selected' : ''}>${esc(t)}</option>`).join('');

  // Restore selection if still valid
  if (users.includes(prevUser)) userSel.value = prevUser;
  if (tags.includes(prevTag))   tagSel.value  = prevTag;
}

function applyKanbanFilters(tickets) {
  return tickets.filter(t => {
    if (kanbanFilterUser && t.assignee !== kanbanFilterUser) return false;
    if (kanbanFilterTag  && !(t.tags ?? []).includes(kanbanFilterTag))  return false;
    return true;
  });
}

function renderKanban(tickets) {
  updateGoalBar(document.getElementById('goal-text')?.textContent, tickets);
  populateKanbanFilters(tickets);
  const visible = applyKanbanFilters(tickets);

  // Active columns
  for (const colId of ACTIVE_COLUMNS) {
    const colEl = document.getElementById(`col-${colId}`);
    if (!colEl) continue;
    const colTickets = visible.filter(t => t.column === colId);
    colEl.querySelector('.kanban-col-count').textContent = colTickets.length || '';
    const list = colEl.querySelector('.task-list');
    list.innerHTML = colTickets.length
      ? colTickets.map(ticketHTML).join('')
      : '<p class="empty-hint">No tickets</p>';
  }

  // Backlog (wide list)
  const backlog = visible.filter(t => t.column === 'backlog');
  const countEl = document.getElementById('backlog-count');
  if (countEl) countEl.textContent = backlog.length || '';
  const listEl = document.getElementById('backlog-list');
  if (listEl) {
    listEl.innerHTML = backlog.length
      ? backlog.map(backlogRowHTML).join('')
      : '<p class="backlog-empty">No tickets in backlog</p>';
  }
}

document.getElementById('kanban-filter-user')?.addEventListener('change', e => {
  kanbanFilterUser = e.target.value;
  renderKanban(state.tickets);
});
document.getElementById('kanban-filter-tag')?.addEventListener('change', e => {
  kanbanFilterTag = e.target.value;
  renderKanban(state.tickets);
});

function isHumanTicket(ticket) {
  const name = (state.humanName ?? 'human').toLowerCase();
  return (ticket.assignee ?? '').toLowerCase() === name;
}

function ticketHTML(ticket) {
  const priority    = ticket.priority ?? 'medium';
  const priColor    = PRIORITY_COLOR[priority] ?? PRIORITY_COLOR.medium;
  const title       = ticket.title ?? ticket.description?.slice(0, 60) ?? ticket.id;
  const assignee    = ticket.assignee ?? '—';
  const tags        = (ticket.tags ?? []).slice(0, 3);
  const projectName = ticket.projectName ?? '';
  const blockers    = ticket.blockedBy ?? [];
  const human       = isHumanTicket(ticket);

  const tagsHTML = tags.map(t =>
    `<span class="ticket-tag">${esc(t)}</span>`
  ).join('');

  const projectHTML = projectName
    ? `<div class="ticket-project" title="${esc(ticket.projectFolder ?? '')}">📁 ${esc(projectName)}</div>`
    : '';

  const blockersHTML = blockers.length
    ? `<div class="ticket-blockers" title="Blocked by: ${esc(blockers.join(', '))}">⛔ ${esc(blockers.join(', '))}</div>`
    : '';

  return `
    <div class="task-card${blockers.length ? ' task-card--blocked' : ''}${human ? ' task-card--human' : ''}" data-ticket-id="${esc(ticket.id)}" draggable="true" title="Drag to move · Click to edit">
      <div class="ticket-top">
        <span class="ticket-id">${esc(ticket.id)}</span>
        <span class="priority-badge" style="color:${priColor};border-color:${priColor}40">${esc(priority)}</span>
      </div>
      <div class="ticket-title">${esc(title)}</div>
      ${projectHTML}
      ${blockersHTML}
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
  const human       = isHumanTicket(ticket);

  return `
    <div class="backlog-row${human ? ' backlog-row--human' : ''}" data-ticket-id="${esc(ticket.id)}" draggable="true" title="Drag to move · Click to edit">
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
      if (column === 'closed') ticket.closedReason = ticket.closedReason ?? 'completed';
      else delete ticket.closedReason;
      renderKanban(state.tickets);

      const dragBody = { column };
      if (column === 'closed') dragBody.closedReason = ticket.closedReason;
      fetch(`/api/kanban/tickets/${encodeURIComponent(draggedTicketId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dragBody),
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
  document.getElementById('board-refresh-btn').addEventListener('click', () => {
    fetch('/api/kanban/tickets')
      .then(r => r.json())
      .then(({ tickets }) => { state.tickets = tickets ?? []; renderKanban(state.tickets); })
      .catch(() => {});
  });
  document.getElementById('modal-close').addEventListener('click', closeTicketModal);
  document.getElementById('modal-cancel').addEventListener('click', closeTicketModal);
  document.getElementById('modal-save').addEventListener('click', saveTicket);
  document.getElementById('modal-comment-submit').addEventListener('click', postComment);
  document.getElementById('edit-column').addEventListener('change', e => {
    document.getElementById('edit-closed-reason-group').style.display =
      e.target.value === 'closed' ? '' : 'none';
  });
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

function populateAssigneeDropdown(selected) {
  const sel = document.getElementById('edit-assignee');
  const names = ['', ...(state.agents ?? []).map(a => a.name), 'human'];
  // Keep any existing value that isn't in the list (e.g. stale assignee from another project)
  if (selected && !names.includes(selected)) names.push(selected);
  sel.innerHTML = names.map(n =>
    `<option value="${esc(n)}"${n === selected ? ' selected' : ''}>${n ? esc(n) : '— unassigned —'}</option>`
  ).join('');
}

function openNewTicketModal() {
  document.getElementById('modal-ticket-id').textContent = 'New Ticket';
  document.getElementById('edit-title').value       = '';
  document.getElementById('edit-description').value = '';
  document.getElementById('edit-priority').value    = 'medium';
  document.getElementById('edit-column').value      = 'backlog';
  document.getElementById('edit-closed-reason-group').style.display = 'none';
  populateAssigneeDropdown('');
  document.getElementById('edit-tags').value        = '';
  document.getElementById('edit-blocked-by').value  = '';
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
  const col = ticket.column ?? 'backlog';
  document.getElementById('edit-column').value      = col;
  document.getElementById('edit-closed-reason-group').style.display = col === 'closed' ? '' : 'none';
  if (col === 'closed') {
    document.getElementById('edit-closed-reason').value = ticket.closedReason ?? 'completed';
  }
  populateAssigneeDropdown(ticket.assignee ?? '');
  document.getElementById('edit-tags').value        = (ticket.tags ?? []).join(', ');
  document.getElementById('edit-blocked-by').value  = (ticket.blockedBy ?? []).join(', ');
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

  const editColumn = document.getElementById('edit-column').value;
  const body = {
    title:        document.getElementById('edit-title').value.trim(),
    description:  document.getElementById('edit-description').value.trim(),
    priority:     document.getElementById('edit-priority').value,
    column:       editColumn,
    closedReason: editColumn === 'closed'
                    ? document.getElementById('edit-closed-reason').value
                    : undefined,
    assignee:     document.getElementById('edit-assignee').value.trim() || null,
    tags:         document.getElementById('edit-tags').value
                    .split(',').map(t => t.trim()).filter(Boolean),
    blockedBy:    document.getElementById('edit-blocked-by').value
                    .split(',').map(t => t.trim().toUpperCase()).filter(Boolean),
  };

  const isCreate = currentEditId === null;
  const url    = isCreate ? '/api/kanban/tickets' : `/api/kanban/tickets/${encodeURIComponent(currentEditId)}`;
  const method = isCreate ? 'POST' : 'PATCH';

  fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async r => {
      const text = await r.text();
      let result;
      try { result = JSON.parse(text); } catch { result = { error: text || `HTTP ${r.status}` }; }
      if (!r.ok || result.error) {
        document.getElementById('modal-error').textContent = result.error ?? `HTTP ${r.status}`;
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
  syncAgentConfigs();
  renderAgents(state.agents);
  renderKanban(state.tickets);
  updateChatAgentSelect();
}

// ── Voice management ──────────────────────────────────────────────────────────

let cachedVoices = null;  // PiperVoice[] | null — loaded once

async function getVoices() {
  if (cachedVoices) return cachedVoices;
  try {
    const res = await fetch('/api/voices');
    cachedVoices = await res.json();
  } catch { cachedVoices = []; }
  return cachedVoices;
}

function getVoiceOverrides() {
  try { return JSON.parse(localStorage.getItem('agentVoices') || '{}'); } catch { return {}; }
}
function setVoiceOverride(agentName, voiceName) {
  const m = getVoiceOverrides();
  if (voiceName) m[agentName] = voiceName; else delete m[agentName];
  localStorage.setItem('agentVoices', JSON.stringify(m));
}

function getSpeakerOverrides() {
  try { return JSON.parse(localStorage.getItem('agentSpeakers') || '{}'); } catch { return {}; }
}
function setSpeakerOverride(agentName, speakerId) {
  const m = getSpeakerOverrides();
  if (speakerId != null) m[agentName] = speakerId; else delete m[agentName];
  localStorage.setItem('agentSpeakers', JSON.stringify(m));
}

/** Return the voice name to use for an agent, falling back to first available. */
function findVoiceForAgent(agentName, voices) {
  if (!voices || voices.length === 0) return null;
  const override = getVoiceOverrides()[agentName];
  if (override && voices.find(v => v.name === override)) return override;
  // Stored voice no longer available — fall back to first
  return voices[0].name;
}

// ── Speech / TTS ──────────────────────────────────────────────────────────────
//
// Flow:
//   1. When agent detail opens, send { type: 'set_speech_agent', name, voice } over WS
//   2. Server synthesises via Piper + Rhubarb and sends back speech_chunk messages
//   3. Browser decodes base64 WAV, plays via Web Audio API
//   4. Audio clock drives avatarAPI.beginSpeech(visemes, getTime) for sync lipsync

let speechWs         = null;   // WebSocket to the same host
let audioCtx         = null;   // lazy AudioContext (requires user gesture first)
const speechQueues   = new Map(); // agentName → SpeechChunk[]
const speechPlaying  = new Set(); // agentName set — currently draining
let currentSource    = null;   // active AudioBufferSourceNode (for stop)
let speechMuted      = false;

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


function setSpeechAgent(agentName, voiceName, speakerName) {
  const ws = getSpeechWs();
  const msg = JSON.stringify({
    type: 'set_speech_agent',
    name: agentName ?? null,
    voice: voiceName ?? null,
    speakerName: speakerName ?? null,
  });
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(msg);
  } else {
    ws.addEventListener('open', () => ws.send(msg), { once: true });
  }
}

function handleSpeechChunk(chunk) {
  if (chunk.agentName !== activeDetailAgent) return; // stale — ignore
  if (speechMuted) return;

  const q = speechQueues.get(chunk.agentName) ?? [];
  q.push(chunk);
  speechQueues.set(chunk.agentName, q);

  if (!speechPlaying.has(chunk.agentName)) drainSpeechQueue(chunk.agentName);
}

async function drainSpeechQueue(agentName) {
  speechPlaying.add(agentName);
  while (true) {
    const q = speechQueues.get(agentName) ?? [];
    if (q.length === 0 || agentName !== activeDetailAgent || speechMuted) break;
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
  // Wait for avatar GLB to finish loading (up to 4 s) so lipsync starts in sync
  if (window.avatarAPI?.whenLoaded) {
    await Promise.race([window.avatarAPI.whenLoaded(), new Promise(r => setTimeout(r, 4000))]);
  }

  // Decode base64 → ArrayBuffer
  const binary = atob(chunk.audioBase64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const audioBuffer = await audioCtx.decodeAudioData(bytes.buffer);
  const source      = audioCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(audioCtx.destination);
  currentSource = source;

  const startAt = audioCtx.currentTime;
  source.start(startAt); // explicit scheduled start for deterministic lipsync alignment

  // Shift viseme clock back by output latency so lips match what is *heard*
  const latency = (audioCtx.outputLatency ?? 0) + (audioCtx.baseLatency ?? 0);

  // Hand audio clock to the avatar for aligned lipsync; pass actual decoded duration
  console.log(`[Lipsync] Agent: ${chunk.visemes?.length ?? 0} visemes, audio=${audioBuffer.duration.toFixed(2)}s, last viseme end=${chunk.visemes?.at(-1)?.end?.toFixed(2) ?? 'none'}s, latency=${latency.toFixed(3)}s`);
  window.avatarAPI?.beginSpeech(chunk.visemes, () => audioCtx.currentTime - startAt - latency, audioBuffer.duration);

  return new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(safetyTimer);
      if (currentSource === source) currentSource = null;
      window.avatarAPI?.endSpeech();
      resolve();
    };
    source.onended = finish;
    // Safety fallback — use actual decoded duration (audioBuffer.duration), not the
    // server-estimated chunk.duration which may be wrong if the model sample rate
    // differs from the 22050 Hz assumed in the pipeline duration estimate.
    const safetyTimer = setTimeout(finish, (audioBuffer.duration + 1.5) * 1000);
  });
}

function stopSpeech(agentName) {
  speechQueues.delete(agentName);
  speechPlaying.delete(agentName);
  if (currentSource) {
    try { currentSource.stop(); } catch { /* already stopped */ }
    currentSource = null;
  }
  window.avatarAPI?.endSpeech();
}

function stopAllSpeech() {
  if (currentSource) {
    try { currentSource.stop(); } catch { /* already stopped */ }
    currentSource = null;
  }
  speechQueues.clear();
  speechPlaying.clear();
  window.avatarAPI?.endSpeech();
}

function toggleMute() {
  speechMuted = !speechMuted;
  const btn = document.getElementById('mute-btn');
  btn.textContent = speechMuted ? 'Unmute' : 'Mute';
  btn.classList.toggle('mute-btn--active', speechMuted);
  if (speechMuted) stopAllSpeech();
}

function clearSpeechQueue(agentName) {
  speechQueues.delete(agentName);
  // endSpeech is called when the current chunk finishes
}

// ── SSE connection ────────────────────────────────────────────────────────────

function connect() {
  const dot = document.getElementById('connection-status');
  const es = new EventSource('/events');

  es.onopen = () => { dot.classList.add('connected'); dot.title = 'Connected'; };
  es.onerror = () => {
    dot.classList.remove('connected');
    dot.title = 'Disconnected — reconnecting…';
    es.close();
    setTimeout(connect, 3000);
  };

  es.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'init') {
      applyState({ agents: msg.agents, tickets: msg.tickets, humanName: msg.project?.humanName ?? 'human' });
      if (msg.project) updateProjectBadge(msg.project.id, msg.project.dir);
      updateGoalBar(msg.project?.goal, msg.tickets);
      fetchTools();
      fetchFiles();
      startFilesRefresh();
      fetchCalendar();
      fetch('/api/telemetry').then(r => r.json()).then(d => applyTelemetrySummary(d.summary)).catch(() => {});
      renderRequests(msg.requests ?? []);
      renderAllowlist(msg.allowlist ?? []);
      initTabs();
      initKanbanDrag();
      initTicketEditing();
      initCLI();
      initAgentDetail();
      initAllowlist();
    } else if (msg.type === 'agent_update') {
      state.agents = msg.agents;
      syncAgentConfigs();
      renderAgents(state.agents);
      updateChatAgentSelect();
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
    } else if (msg.type === 'telemetry_update') {
      if (telScope === 'project') applyTelemetrySummary(msg.summary);
      else refreshTelemetryBar();
    } else if (msg.type === 'requests_update') {
      renderRequests(msg.requests ?? []);
    } else if (msg.type === 'email_allowlist_update') {
      renderAllowlist(msg.allowlist ?? []);
    } else if (msg.type === 'files_update') {
      renderFilesList(msg.sources, msg.outputs, msg.tickets);
    } else if (msg.type === 'meeting_started') {
      const avatarMap = {}, voiceMap = {}, speakerMap = {}, backgroundMap = {}, hatMap = {};
      for (const a of state.agents) {
        if (a.avatar)      avatarMap[a.name]      = a.avatar;
        if (a.voice)       voiceMap[a.name]       = a.voice;
        if (a.speakerName) speakerMap[a.name]     = a.speakerName;
        if (a.background)  backgroundMap[a.name]  = a.background;
        if (a.hatType)     hatMap[a.name]         = a.hatType;
      }
      window.meetingUI?.open(msg.meetingId, msg.topic, msg.participants ?? [], msg.facilitator ?? '', avatarMap, voiceMap, speakerMap, backgroundMap, state.humanName, hatMap);
    } else if (msg.type === 'meeting_turn') {
      window.meetingUI?.addTurn(msg.participant, msg.content);
    } else if (msg.type === 'meeting_human_turn') {
      window.meetingUI?.requestHumanTurn(msg.meetingId);
    } else if (msg.type === 'meeting_hand_raised') {
      window.meetingUI?.setHandRaised(msg.participant, msg.raised);
    } else if (msg.type === 'meeting_closed') {
      window.meetingUI?.close(msg.meetingId);
      fetchFiles(); // minutes may have been written
    }
  };
}

function fetchTools() {
  fetch('/api/tools')
    .then(r => r.json())
    .then(tools => renderTools(tools))
    .catch(() => {});
}

// ── Human Requests ────────────────────────────────────────────────────────────

function renderRequests(requests) {
  const el = document.getElementById('requests-content');
  if (!el) return;

  // Update badge
  const pending = requests.filter(r => r.status === 'pending');
  const badge   = document.getElementById('requests-badge');
  if (badge) {
    badge.textContent = String(pending.length);
    badge.hidden = pending.length === 0;
  }

  if (requests.length === 0) {
    el.innerHTML = '<p class="requests-empty">No requests from agents yet.</p>';
    return;
  }

  const answered = requests.filter(r => r.status === 'answered');
  el.innerHTML = answered.length > 0
    ? `<div class="requests-toolbar"><button class="requests-clear-btn" id="requests-clear-answered">Clear answered (${answered.length})</button></div>`
    : '';
  document.getElementById('requests-clear-answered')?.addEventListener('click', async () => {
    await fetch('/api/human-requests/answered', { method: 'DELETE' });
  });

  for (const req of requests) {
    const item = document.createElement('div');
    item.className = `request-item request-item--${req.status}${req.urgency === 'high' ? ' request-item--high' : ''}`;
    item.dataset.id = req.id;

    const timeStr = new Date(req.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const msgHtml = window.marked ? window.marked.parse(req.message) : esc(req.message);

    const ticketBadge = req.relatedTicketId
      ? `<span class="request-ticket-ref" title="Related ticket">${esc(req.relatedTicketId)}</span>`
      : '';

    const statusPart = req.status === 'answered'
      ? `<span class="request-done-badge">Answered</span>`
      : `<span class="request-urgency-badge request-urgency--${req.urgency}">${req.urgency === 'high' ? 'Urgent' : 'Low'}</span>`;

    const bodyPart = req.status === 'answered'
      ? `<div class="request-response-display">
           <span class="request-response-label">Your response</span>
           <div class="request-response-text">${esc(req.response ?? '')}</div>
         </div>`
      : `<div class="request-reply-area" hidden>
           <textarea class="request-reply-input" placeholder="Type your response…" rows="3"></textarea>
           <div class="request-reply-footer">
             <span class="request-reply-error"></span>
             <button class="request-cancel-btn">Cancel</button>
             <button class="request-reply-submit">Send Reply</button>
           </div>
         </div>`;

    item.innerHTML = `
      <div class="request-header">
        <span class="request-agent">${esc(req.agentName)}</span>
        ${statusPart}
        ${ticketBadge}
        <span class="request-time">${timeStr}</span>
      </div>
      <div class="request-message">${msgHtml}</div>
      ${bodyPart}`;

    if (req.status === 'pending') {
      item.addEventListener('click', (e) => {
        const area = item.querySelector('.request-reply-area');
        if (area.contains(e.target)) return;
        const open = area.hidden;
        area.hidden = !open;
        if (open) area.querySelector('textarea').focus();
      });

      item.querySelector('.request-reply-submit').addEventListener('click', async () => {
        const btn      = item.querySelector('.request-reply-submit');
        const textarea = item.querySelector('.request-reply-input');
        const errorEl  = item.querySelector('.request-reply-error');
        const response = textarea.value.trim();
        if (!response) { errorEl.textContent = 'Please enter a response.'; return; }
        btn.disabled = true; btn.textContent = '…'; errorEl.textContent = '';
        try {
          const r = await fetch(`/api/human-requests/${encodeURIComponent(req.id)}/respond`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ response }),
          });
          const data = await r.json();
          if (!r.ok || data.error) { errorEl.textContent = data.error ?? 'Failed'; return; }
          // SSE requests_update will re-render
        } catch (err) {
          errorEl.textContent = err.message || 'Failed';
        } finally {
          btn.disabled = false; btn.textContent = 'Send Reply';
        }
      });

      item.querySelector('.request-cancel-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        await fetch(`/api/human-requests/${encodeURIComponent(req.id)}`, { method: 'DELETE' });
        // SSE requests_update will re-render
      });
    }

    el.appendChild(item);
  }
}

// ── Email Allowlist ───────────────────────────────────────────────────────────

function renderAllowlist(entries) {
  const el = document.getElementById('allowlist-list');
  if (!el) return;

  const pending = entries.filter(e => e.status === 'pending');
  const badge   = document.getElementById('allowlist-badge');
  if (badge) {
    badge.textContent = String(pending.length);
    badge.hidden = pending.length === 0;
  }

  if (entries.length === 0) {
    el.innerHTML = '<p class="allowlist-empty">No email addresses in the allowlist yet.</p>';
    return;
  }

  el.innerHTML = '';
  for (const entry of entries) {
    const item = document.createElement('div');
    item.className = `allowlist-item allowlist-item--${entry.status}`;

    const timeStr  = new Date(entry.requestedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
    const reasonHtml = entry.reason ? `<span class="allowlist-reason">${esc(entry.reason)}</span>` : '';
    const byHtml   = `<span class="allowlist-by">by ${esc(entry.requestedBy)}</span>`;

    let actionHtml = '';
    if (entry.status === 'pending') {
      actionHtml = `
        <button class="allowlist-approve-btn" data-email="${esc(entry.email)}">Approve</button>
        <button class="allowlist-reject-btn"  data-email="${esc(entry.email)}">Reject</button>`;
    }

    item.innerHTML = `
      <div class="allowlist-row">
        <span class="allowlist-email">${esc(entry.email)}</span>
        <span class="allowlist-status allowlist-status--${entry.status}">${entry.status}</span>
        ${byHtml}
        <span class="allowlist-time">${timeStr}</span>
        ${actionHtml}
        <button class="allowlist-delete-btn" data-email="${esc(entry.email)}" title="Remove">✕</button>
      </div>
      ${reasonHtml}`;

    item.querySelector('.allowlist-delete-btn')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const email = item.querySelector('.allowlist-delete-btn').dataset.email;
      await fetch(`/api/email-allowlist/${encodeURIComponent(email)}`, { method: 'DELETE' });
    });
    item.querySelector('.allowlist-approve-btn')?.addEventListener('click', async () => {
      const email = item.querySelector('.allowlist-approve-btn').dataset.email;
      await fetch(`/api/email-allowlist/${encodeURIComponent(email)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      });
    });
    item.querySelector('.allowlist-reject-btn')?.addEventListener('click', async () => {
      const email = item.querySelector('.allowlist-reject-btn').dataset.email;
      await fetch(`/api/email-allowlist/${encodeURIComponent(email)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject' }),
      });
    });

    el.appendChild(item);
  }
}

function initAllowlist() {
  const addBtn    = document.getElementById('allowlist-add-btn');
  const emailInp  = document.getElementById('allowlist-add-input');
  const reasonInp = document.getElementById('allowlist-add-reason');
  if (!addBtn || !emailInp) return;

  const doAdd = async () => {
    const email  = emailInp.value.trim();
    const reason = reasonInp?.value.trim() || undefined;
    if (!email) return;
    addBtn.disabled = true;
    try {
      await fetch('/api/email-allowlist', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, reason }),
      });
      emailInp.value  = '';
      if (reasonInp) reasonInp.value = '';
    } finally {
      addBtn.disabled = false;
    }
  };

  addBtn.addEventListener('click', doAdd);
  emailInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });

  fetch('/api/email-allowlist').then(r => r.json()).then(renderAllowlist).catch(() => {});
}

// ── MCP Catalogue ─────────────────────────────────────────────────────────────

const CATEGORY_COLOR = {
  productivity: { bg: 'rgba(88,166,255,0.12)',  text: '#58a6ff'  },
  files:        { bg: 'rgba(63,185,80,0.12)',   text: '#3fb950'  },
  web:          { bg: 'rgba(227,179,65,0.12)',  text: '#e3b341'  },
  data:         { bg: 'rgba(248,81,73,0.12)',   text: '#f85149'  },
  dev:          { bg: 'rgba(139,148,158,0.12)', text: '#8b949e'  },
};

function renderMCPCatalogue(catalogue, googleStatus = { authenticated: false }) {
  const el = document.getElementById('mcp-content');
  if (!el) return;

  const sharedCatalogue   = catalogue.filter(e => e.users?.includes('human'));
  const personalCatalogue = catalogue.filter(e => e.users?.includes('agent'));

  const categories = [...new Set(sharedCatalogue.map(e => e.category))];
  let html = '';

  // Google auth banner — shown if any Google HTTP MCPs are present
  const hasGoogleHttpMcps = sharedCatalogue.some(e =>
    ['google-gmail','google-calendar','google-drive','google-chat','google-contacts'].includes(e.id));
  if (hasGoogleHttpMcps) {
    if (googleStatus.authenticated) {
      html += `<div class="mcp-google-auth-banner connected">
        <span class="mcp-google-auth-icon">✓</span>
        <span>Google Account connected</span>
        <button class="mcp-google-auth-btn disconnect" onclick="disconnectGoogle()">Disconnect</button>
      </div>`;
    } else {
      html += `<div class="mcp-google-auth-banner">
        <span class="mcp-google-auth-icon">⚠</span>
        <span>Connect your Google Account to use Gmail, Calendar, Drive, Chat, and Contacts MCPs</span>
        <button class="mcp-google-auth-btn" onclick="openGoogleAuthPopup()">Connect Google</button>
      </div>`;
    }
  }

  if (personalCatalogue.length > 0) {
    html += `<div class="mcp-personal-note">
      <span class="mcp-personal-note-icon">👤</span>
      <span><strong>Personal MCPs</strong> (${personalCatalogue.map(e => e.name).join(', ')}) are configured per-agent with individual credentials — open an agent's detail panel to set them up.</span>
    </div>`;
  }

  for (const cat of categories) {
    const entries = sharedCatalogue.filter(e => e.category === cat);
    const cc = CATEGORY_COLOR[cat] || CATEGORY_COLOR.dev;
    html += `<div class="mcp-cat-label" style="color:${cc.text}">${esc(cat)}</div>`;
    for (const entry of entries) {
      const envHtml = (entry.envStatus ?? []).map(v =>
        `<span class="mcp-env-badge ${v.present ? 'present' : 'missing'}" title="${v.present ? 'Set' : 'Not set'}">${esc(v.name)}</span>`
      ).join('');
      const catBadge = `<span class="mcp-cat-badge" style="background:${cc.bg};color:${cc.text}">${esc(cat)}</span>`;

      const linkHtml = entry.url
        ? `<a class="mcp-entry-link" href="${esc(entry.url)}" target="_blank" rel="noopener noreferrer" title="Setup docs ↗">docs ↗</a>`
        : '';
      html += `
        <div class="mcp-entry ${entry.enabled ? 'enabled' : ''}" data-id="${esc(entry.id)}">
          <div class="mcp-entry-main">
            <div class="mcp-entry-title">
              <span class="mcp-entry-name">${esc(entry.name)}</span>
              ${catBadge}
              ${envHtml}
              ${linkHtml}
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
  Promise.all([
    fetch('/api/mcp/catalogue').then(r => r.json()),
    fetch('/api/auth/google/status').then(r => r.json()).catch(() => ({ authenticated: false })),
  ])
    .then(([catalogue, googleStatus]) => renderMCPCatalogue(catalogue, googleStatus))
    .catch(() => {});
}

function openGoogleAuthPopup() {
  const popup = window.open('/api/auth/google/start', 'google-auth', 'width=600,height=700,scrollbars=yes');
  window.addEventListener('message', function onMsg(e) {
    if (e.data?.type === 'google-auth-success') {
      window.removeEventListener('message', onMsg);
      popup?.close();
      fetchMCPCatalogue();
    } else if (e.data?.type === 'google-auth-error') {
      window.removeEventListener('message', onMsg);
      popup?.close();
      alert('Google authentication failed: ' + (e.data.error || 'unknown error'));
    }
  });
}

function disconnectGoogle() {
  fetch('/api/auth/google', { method: 'DELETE' })
    .then(() => fetchMCPCatalogue())
    .catch(() => {});
}

// ── MCP Catalogue Editor ──────────────────────────────────────────────────────

let _mcpEditorSelected = null;     // id of selected entry, or null for new
let _mcpEditorCurrentEntry = null; // full entry object for the selected entry
let _mcpEditorFeatureGetter = () => ({}); // returns { envVarName: 'key:on,key:off,...' }

function openMCPEditor() {
  _mcpEditorSelected = null;
  fetchAndRenderEditorList();
  clearEditorForm();
  document.getElementById('mcp-editor-modal').hidden = false;
}

function closeMCPEditor() {
  document.getElementById('mcp-editor-modal').hidden = true;
}

async function fetchAndRenderEditorList() {
  const listEl = document.getElementById('mcp-editor-list');
  listEl.innerHTML = '<p class="mcp-editor-loading">Loading…</p>';
  try {
    const raw = await fetch('/api/mcp/catalogue').then(r => r.json());
    renderEditorList(raw);
  } catch {
    listEl.innerHTML = '<p class="mcp-editor-loading">Failed to load.</p>';
  }
}

function renderEditorList(entries) {
  const listEl = document.getElementById('mcp-editor-list');
  const grouped = {};
  for (const e of entries) {
    if (!grouped[e.category]) grouped[e.category] = [];
    grouped[e.category].push(e);
  }
  let html = '';
  for (const [cat, items] of Object.entries(grouped)) {
    const cc = CATEGORY_COLOR[cat] || CATEGORY_COLOR.dev;
    html += `<div class="mcp-editor-cat-label" style="color:${cc.text}">${esc(cat)}</div>`;
    for (const item of items) {
      html += `<button class="mcp-editor-item${_mcpEditorSelected === item.id ? ' selected' : ''}" data-id="${esc(item.id)}">${esc(item.name)}</button>`;
    }
  }
  listEl.innerHTML = html || '<p class="mcp-editor-loading">No entries</p>';
  listEl.querySelectorAll('.mcp-editor-item').forEach(btn => {
    btn.addEventListener('click', () => selectEditorEntry(btn.dataset.id, entries));
  });
}

function clearEditorForm() {
  document.getElementById('mcp-editor-placeholder').hidden = false;
  document.getElementById('mcp-editor-fields').hidden = true;
  document.getElementById('mcp-ef-error').textContent = '';
  _mcpEditorSelected = null;
}

function selectEditorEntry(id, entries) {
  _mcpEditorSelected = id;
  const entry = entries.find(e => e.id === id);
  if (!entry) return;
  _mcpEditorCurrentEntry = entry;

  document.getElementById('mcp-editor-placeholder').hidden = true;
  document.getElementById('mcp-editor-fields').hidden = false;
  document.getElementById('mcp-ef-error').textContent = '';

  document.getElementById('mcp-ef-id').value          = entry.id;
  document.getElementById('mcp-ef-id').readOnly       = true;
  document.getElementById('mcp-ef-name').value        = entry.name || '';
  document.getElementById('mcp-ef-description').value = entry.description || '';
  document.getElementById('mcp-ef-category').value    = entry.category || 'productivity';
  document.getElementById('mcp-ef-notes').value       = entry.notes || '';
  document.getElementById('mcp-ef-docs-url').value    = entry.url || '';
  document.getElementById('mcp-ef-users-human').checked = !!entry.users?.includes('human');
  document.getElementById('mcp-ef-users-agent').checked = !!entry.users?.includes('agent');

  const transport = entry.config?.transport || 'stdio';
  document.getElementById('mcp-ef-transport').value = transport;
  toggleTransportFields(transport);

  if (transport === 'stdio') {
    document.getElementById('mcp-ef-command').value = entry.config.command || '';
    document.getElementById('mcp-ef-args').value    = (entry.config.args || []).join('\n');
    const nonFeatureVars = (entry.envVars || []).filter(v => (typeof v === 'string' || v.type !== 'features'));
    document.getElementById('mcp-ef-envvars').value = nonFeatureVars.map(v => typeof v === 'string' ? v : v.name).join('\n');
  } else {
    document.getElementById('mcp-ef-url-endpoint').value = entry.config.url || '';
    const headers = entry.config.headers ?? {};
    document.getElementById('mcp-ef-headers').value =
      Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\n');
  }

  // Populate feature checkboxes for any envVar with type='features'
  populateEditorFeatures(entry);

  // Highlight selected in list
  document.querySelectorAll('.mcp-editor-item').forEach(b =>
    b.classList.toggle('selected', b.dataset.id === id));
}

function populateEditorFeatures(entry) {
  const container = document.getElementById('mcp-ef-features-container');
  container.innerHTML = '';
  container.hidden = true;
  _mcpEditorFeatureGetter = () => ({});

  const featureVars = (entry?.envVars || []).filter(v => typeof v === 'object' && v.type === 'features');
  if (!featureVars.length) return;

  container.hidden = false;
  const allChecks = {}; // varName -> { getter }

  for (const varDef of featureVars) {
    const currentVal = entry.config?.env?.[varDef.name] ?? '';
    const overrides = parseFeatureOverrides(currentVal);

    const section = document.createElement('div');
    section.className = 'mcp-ef-group personal-mcp-features-section';

    const label = document.createElement('label');
    label.className = 'mcp-ef-label';
    label.textContent = varDef.name;
    section.appendChild(label);

    const grid = document.createElement('div');
    grid.className = 'personal-mcp-features-grid';

    const checksMap = {};
    for (const feat of (varDef.features || [])) {
      const isOn = feat.key in overrides ? overrides[feat.key] : feat.defaultOn;
      const item = document.createElement('label');
      item.className = 'personal-mcp-feature-item';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = isOn;
      item.appendChild(cb);
      item.appendChild(document.createTextNode(feat.label));
      grid.appendChild(item);
      checksMap[feat.key] = { cb, defaultOn: feat.defaultOn };
    }
    section.appendChild(grid);
    container.appendChild(section);
    allChecks[varDef.name] = { checksMap, varDef };
  }

  _mcpEditorFeatureGetter = () => {
    const result = {};
    for (const [varName, { checksMap }] of Object.entries(allChecks)) {
      result[varName] = serializeFeatureOverrides(checksMap);
    }
    return result;
  };
}

function toggleTransportFields(transport) {
  document.getElementById('mcp-ef-stdio-fields').hidden   = transport !== 'stdio';
  document.getElementById('mcp-ef-url-fields').hidden     = transport === 'stdio';
  document.getElementById('mcp-ef-headers-group').hidden  = transport !== 'http';
}

function buildEntryFromForm() {
  const transport = document.getElementById('mcp-ef-transport').value;
  const envVarNames = document.getElementById('mcp-ef-envvars').value
    .split('\n').map(s => s.trim()).filter(Boolean);

  // Collect feature var values from checkboxes
  const featureEnvValues = _mcpEditorFeatureGetter();
  const featureVarNames = Object.keys(featureEnvValues);

  const config = transport === 'stdio'
    ? {
        transport: 'stdio',
        command: document.getElementById('mcp-ef-command').value.trim(),
        args: document.getElementById('mcp-ef-args').value
          .split('\n').map(s => s.trim()).filter(Boolean),
        ...((envVarNames.length > 0 || featureVarNames.length > 0)
          ? { env: {
                ...Object.fromEntries(envVarNames.map(k => [k, ''])),
                ...Object.fromEntries(featureVarNames.map(k => [k, featureEnvValues[k]])),
              } }
          : {}),
      }
    : (() => {
        const cfg = { transport, url: document.getElementById('mcp-ef-url-endpoint').value.trim() };
        if (transport === 'http') {
          const headerLines = document.getElementById('mcp-ef-headers').value
            .split('\n').map(s => s.trim()).filter(Boolean);
          const headers = Object.fromEntries(
            headerLines.map(line => { const i = line.indexOf(':'); return [line.slice(0, i).trim(), line.slice(i + 1).trim()]; })
              .filter(([k]) => k),
          );
          if (Object.keys(headers).length) cfg.headers = headers;
        }
        return cfg;
      })();

  // Preserve EnvVarDef objects for feature vars from the current entry
  const preservedFeatureVarDefs = (_mcpEditorCurrentEntry?.envVars || [])
    .filter(v => typeof v === 'object' && v.type === 'features' && featureVarNames.includes(v.name));
  const allEnvVars = [...envVarNames, ...preservedFeatureVarDefs];

  return {
    id:          document.getElementById('mcp-ef-id').value.trim(),
    name:        document.getElementById('mcp-ef-name').value.trim(),
    description: document.getElementById('mcp-ef-description').value.trim(),
    category:    document.getElementById('mcp-ef-category').value,
    config,
    ...(allEnvVars.length > 0 ? { envVars: allEnvVars } : {}),
    ...(() => { const u = []; if (document.getElementById('mcp-ef-users-human').checked) u.push('human'); if (document.getElementById('mcp-ef-users-agent').checked) u.push('agent'); return { users: u }; })(),
    notes:   document.getElementById('mcp-ef-notes').value.trim() || undefined,
    url:     document.getElementById('mcp-ef-docs-url').value.trim() || undefined,
  };
}

function initMCPEditor() {
  document.getElementById('mcp-catalogue-edit-btn').addEventListener('click', openMCPEditor);
  document.getElementById('mcp-editor-close').addEventListener('click', closeMCPEditor);
  document.getElementById('mcp-editor-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('mcp-editor-modal')) closeMCPEditor();
  });

  document.getElementById('mcp-editor-add-btn').addEventListener('click', () => {
    _mcpEditorSelected = null;
    document.getElementById('mcp-editor-placeholder').hidden = true;
    document.getElementById('mcp-editor-fields').hidden = false;
    document.getElementById('mcp-ef-error').textContent = '';
    // Clear all fields for a new entry
    ['mcp-ef-id','mcp-ef-name','mcp-ef-description','mcp-ef-notes','mcp-ef-docs-url',
     'mcp-ef-command','mcp-ef-args','mcp-ef-envvars','mcp-ef-url-endpoint','mcp-ef-headers'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('mcp-ef-id').readOnly = false;
    document.getElementById('mcp-ef-users-human').checked = true;
    document.getElementById('mcp-ef-users-agent').checked = false;
    document.getElementById('mcp-ef-transport').value = 'stdio';
    document.getElementById('mcp-ef-category').value = 'productivity';
    toggleTransportFields('stdio');
    const fc = document.getElementById('mcp-ef-features-container');
    fc.innerHTML = '';
    fc.hidden = true;
    _mcpEditorCurrentEntry = null;
    _mcpEditorFeatureGetter = () => ({});
    document.querySelectorAll('.mcp-editor-item').forEach(b => b.classList.remove('selected'));
  });

  document.getElementById('mcp-ef-transport').addEventListener('change', e => {
    toggleTransportFields(e.target.value);
  });

  document.getElementById('mcp-ef-save-btn').addEventListener('click', async () => {
    const errEl = document.getElementById('mcp-ef-error');
    errEl.textContent = '';
    const entry = buildEntryFromForm();
    if (!entry.id) { errEl.textContent = 'ID is required.'; return; }
    if (!entry.name) { errEl.textContent = 'Name is required.'; return; }

    const isNew = !_mcpEditorSelected;
    const url    = isNew ? '/api/mcp/catalogue' : `/api/mcp/catalogue/${encodeURIComponent(_mcpEditorSelected)}`;
    const method = isNew ? 'POST' : 'PATCH';

    try {
      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      }).then(r => r.json());
      if (res.error) { errEl.textContent = res.error; return; }
      _mcpEditorSelected = entry.id;
      await fetchAndRenderEditorList();
      fetchMCPCatalogue(); // refresh the main MCP panel
    } catch { errEl.textContent = 'Save failed.'; }
  });

  document.getElementById('mcp-ef-remove-btn').addEventListener('click', async () => {
    if (!_mcpEditorSelected) return;
    const errEl = document.getElementById('mcp-ef-error');
    errEl.textContent = '';
    try {
      const res = await fetch(`/api/mcp/catalogue/${encodeURIComponent(_mcpEditorSelected)}`, {
        method: 'DELETE',
      }).then(r => r.json());
      if (res.error) { errEl.textContent = res.error; return; }
      clearEditorForm();
      await fetchAndRenderEditorList();
      fetchMCPCatalogue();
    } catch { errEl.textContent = 'Remove failed.'; }
  });
}

// ── Agent detail drawer ───────────────────────────────────────────────────────

let activeDetailAgent = null;
let activeChatAgent   = null;
let filesRefreshTimer = null;
let toolCallDetail    = localStorage.getItem('toolCallDetail') ?? 'simple'; // 'simple' | 'detailed'

function togglePromptPreview(_show) { /* agent-prompt-preview removed from HTML */ }

// ── Pricing ───────────────────────────────────────────────────────────────────

let _pricingCache = null; // { pricing: Record<model, {input,output}>, freeProviders: string[] }

async function loadPricing() {
  if (_pricingCache) return _pricingCache;
  try {
    _pricingCache = await fetch('/api/pricing').then(r => r.json());
  } catch { _pricingCache = { pricing: {}, freeProviders: [] }; }
  return _pricingCache;
}

/** Fetch and display the system prompt for the currently configured hat/name/specialisation. */
async function refreshPromptPreview() {
  if (!activeDetailAgent) return;
  const textEl  = document.getElementById('agent-prompt-preview-text');
  const agent   = state.agents.find(a => a.name === activeDetailAgent);
  const hats    = agent?.hatType ?? ['white'];
  const name    = (document.getElementById('agent-detail-name').value.trim()) || activeDetailAgent;
  const spec    = agent?.specialisation ?? '';
  textEl.textContent = 'Loading…';
  try {
    const params = new URLSearchParams({ name });
    for (const h of hats) params.append('hat', h);
    if (spec) params.set('specialisation', spec);
    const res = await fetch(`/api/agents/${encodeURIComponent(activeDetailAgent)}/prompt-preview?${params}`);
    const data = await res.json();
    textEl.textContent = data.prompt ?? data.error ?? 'Error';
    // assume a token is about 4 characters
    const promptLength = data.prompt ? data.prompt.length : 0;
    const numTokens = promptLength / 4
    document.getElementById('agent-prompt-preview-length').textContent = `Length: ${promptLength} chars  ~${numTokens} tokens`; 
  } catch (e) {
    textEl.textContent = 'Failed to load prompt.';
  }
}

/** Show a price hint or unknown-model warning below the model select. */
async function updatePricingHint(providerId, modelId, lineEl, hintEl) {
  if (!lineEl || !hintEl) return;
  if (!modelId) { lineEl.hidden = true; return; }

  const { pricing, freeProviders } = await loadPricing();

  if (freeProviders.includes(providerId)) {
    hintEl.className = 'agent-config-pricing-hint agent-config-pricing-free';
    hintEl.textContent = 'Free — local inference, no API cost';
    lineEl.hidden = false;
    return;
  }

  const p = pricing[modelId];
  if (p) {
    hintEl.className = 'agent-config-pricing-hint agent-config-pricing-known';
    hintEl.textContent = `$${p.input}/M input · $${p.output}/M output tokens`;
    lineEl.hidden = false;
  } else {
    hintEl.className = 'agent-config-pricing-hint agent-config-pricing-unknown';
    hintEl.textContent = 'Pricing unknown for this model — costs may be incorrect in telemetry';
    lineEl.hidden = false;
  }
}

/** Update the max-context placeholder to match the selected model's context window. */
async function updateContextWindowPlaceholder(modelId) {
  const input = document.getElementById('add-agent-max-context');
  if (!input) return;
  const { contextWindows } = await loadPricing();
  const cw = contextWindows?.[modelId];
  input.placeholder = cw ? `${cw.toLocaleString()} (model max)` : 'Model default';
}

// ── Provider / model catalogue ────────────────────────────────────────────────

let _providersCache = null;
let _modelsRefreshPromise = null; // in-flight refresh dedup

/** Load provider metadata (fast — static models unless server cache already warm). */
function loadProviders() {
  if (_providersCache) return Promise.resolve(_providersCache);
  return fetch('/api/providers')
    .then(r => r.json())
    .then(list => { _providersCache = list; return list; })
    .catch(() => []);
}

/**
 * Fetch live models from the server (server applies per-provider TTL caching:
 * 24 h for cloud providers, 5 min for Ollama/LM Studio).
 * Merges results into _providersCache and calls onModelsRefreshed() if anything changed.
 * Pass force=true to bypass the server cache and re-query provider APIs immediately.
 */
async function refreshProviderModels(force = false) {
  if (_modelsRefreshPromise && !force) return _modelsRefreshPromise;
  _modelsRefreshPromise = (async () => {
    try {
      const url = force ? '/api/providers/models?refresh=true' : '/api/providers/models';
      const list = await fetch(url).then(r => r.json());
      // Ensure base providers are loaded first
      const providers = await loadProviders();
      let changed = false;
      for (const { id, models } of list) {
        const p = providers.find(p => p.id === id);
        if (!p) continue;
        // Only update if the model list actually changed
        const prev = JSON.stringify(p.models);
        if (JSON.stringify(models) !== prev && models.length > 0) {
          p.models = models;
          // Also update defaultModel if it's currently pointing at a stale static default
          if (!models.includes(p.defaultModel) && models.length > 0) {
            p.defaultModel = models[0];
          }
          changed = true;
        }
      }
      if (changed) onModelsRefreshed();
    } catch { /* non-fatal — static models remain */ }
    _modelsRefreshPromise = null;
  })();
  return _modelsRefreshPromise;
}

/** Called after live models are merged into _providersCache. Re-populates any open model selects. */
function onModelsRefreshed() {
  if (!_providersCache) return;
  // Agent config panel
  const agentProvSel  = document.getElementById('agent-config-provider');
  const agentModelSel = document.getElementById('agent-config-model');
  if (agentProvSel && agentModelSel && !agentModelSel.hidden) {
    const pid = agentProvSel.value;
    const current = agentModelSel.value;
    const provider = _providersCache.find(p => p.id === pid);
    applyLocalProviderUI(provider);
    if (!agentModelSel.hidden) populateModelSelect(agentModelSel, _providersCache, pid, current);
  }
  // Add-agent panel
  const addProvSel  = document.getElementById('add-agent-provider');
  const addModelSel = document.getElementById('add-agent-model');
  if (addProvSel && addModelSel && !addModelSel.closest('[hidden]')) {
    const pid = addProvSel.value;
    const current = addModelSel.value;
    populateModelSelect(addModelSel, _providersCache, pid, current);
  }
}

/**
 * Populate the provider <select> from the catalogue.
 * Only providers that have a backend implementation are shown.
 */
function populateProviderSelect(sel, providers, selectedId) {
  sel.innerHTML = '';
  for (const p of providers) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.label;
    opt.selected = p.id === selectedId;
    sel.appendChild(opt);
  }
}

/** Switch between model dropdown vs free-text input for local providers with no model list. */
function applyLocalProviderUI(provider) {
  const modelSel   = document.getElementById('agent-config-model');
  const modelInput = document.getElementById('agent-config-model-custom');
  // Show free-text only if this is a local provider AND we have no models (live fetch returned nothing)
  const noModels = !!provider?.baseUrlEnvKey && (!provider.models || provider.models.length === 0);
  modelSel.hidden   = noModels;
  modelInput.hidden = !noModels;
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


// ── Shared agent feed helper ──────────────────────────────────────────────────

function loadAgentFeedInto(name, feedEl) {
  feedEl.innerHTML = '<p class="feed-empty">Loading…</p>';
  fetch(`/api/agents/${encodeURIComponent(name)}/feed`)
    .then(r => r.json())
    .then(events => {
      feedEl.innerHTML = '';
      if (!events.length) { feedEl.innerHTML = '<p class="feed-empty">No activity yet.</p>'; return; }
      for (const ev of events) { const el = buildFeedItem(ev, name); if (el) feedEl.appendChild(el); }
      feedEl.scrollTop = feedEl.scrollHeight;
    })
    .catch(() => { feedEl.innerHTML = '<p class="feed-empty">Failed to load.</p>'; });
}

// ── Agent chat: delegate to the shared agent-detail modal in chat-only mode ───

function initAgentChat() { /* wired via initAgentDetail's card click handler */ }

function openAgentChat(name) {
  openAgentDetail(name, true);   // true = chat-only mode
}

function closeAgentChat() {
  closeAgentDetail();
}

let agentDetailInited = false;

function initAgentDetail() {
  if (agentDetailInited) return;
  agentDetailInited = true;

  document.getElementById('agents-container').addEventListener('click', e => {
    if (e.target.closest('.agent-card-chat-btn')) {
      const card = e.target.closest('.agent-card');
      if (card) openAgentChat(card.dataset.name);
      return;
    }
    const card = e.target.closest('.agent-card');
    if (card) openAgentDetail(card.dataset.name);
  });
  document.getElementById('agent-detail-close').addEventListener('click', closeAgentDetail);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && activeDetailAgent) closeAgentDetail();
  });
  // Click on backdrop (overlay itself, not the modal box) closes the modal
  document.getElementById('agent-detail-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('agent-detail-modal')) closeAgentDetail();
  });

  // Name rename — commit on Enter or blur
  const nameInput = document.getElementById('agent-detail-name');
  const commitRename = async () => {
    if (!activeDetailAgent) return;
    const newName = nameInput.value.trim();
    if (!newName || newName === activeDetailAgent) return;
    const res = await fetch(`/api/agents/${encodeURIComponent(activeDetailAgent)}/name`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    }).then(r => r.json());
    if (res.error) { nameInput.value = activeDetailAgent; alert(res.error); return; }
    // Transfer any local overrides to the new name
    const voiceO = getVoiceOverrides(); if (voiceO[activeDetailAgent]) { voiceO[newName] = voiceO[activeDetailAgent]; delete voiceO[activeDetailAgent]; localStorage.setItem('agentVoices', JSON.stringify(voiceO)); }
    const avatarO = getAvatarOverrides(); if (avatarO[activeDetailAgent]) { avatarO[newName] = avatarO[activeDetailAgent]; delete avatarO[activeDetailAgent]; localStorage.setItem('agentAvatars', JSON.stringify(avatarO)); }
    activeDetailAgent = newName;
  };
  nameInput.addEventListener('blur', commitRename);
  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); nameInput.blur(); }
    if (e.key === 'Escape') { nameInput.value = activeDetailAgent; nameInput.blur(); }
  });

  // Configure button: switch from chat-only to configure mode
  document.getElementById('agent-detail-configure-btn').addEventListener('click', () => {
    document.getElementById('agent-detail').classList.remove('chat-mode');
    activeChatAgent = null;
  });

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


  // Apply button — saves email + MCP selection
  document.getElementById('agent-config-apply').addEventListener('click', async () => {
    if (!activeDetailAgent) return;
    const btn = document.getElementById('agent-config-apply');
    btn.textContent = '…'; btn.disabled = true;
    try {
      const tasks = [];
      const email = document.getElementById('agent-config-email').value.trim() || undefined;
      tasks.push(fetch(`/api/agents/${encodeURIComponent(activeDetailAgent)}/email`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      }));
      const mcpLine = document.getElementById('agent-config-mcp-line');
      if (mcpLine && !mcpLine.hidden) {
        const checks = Array.from(document.querySelectorAll('#agent-config-mcp-list input[type="checkbox"]'));
        const allChecked = checks.every(c => c.checked);
        const servers = allChecked ? null : checks.filter(c => c.checked).map(c => c.value);
        tasks.push(fetch(`/api/agents/${encodeURIComponent(activeDetailAgent)}/mcp-servers`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ servers }),
        }));
      }
      await Promise.all(tasks);
      btn.textContent = '✓';
    } catch {
      btn.textContent = '✗';
    }
    setTimeout(() => { btn.textContent = 'Apply'; btn.disabled = false; }, 1500);
  });
}

function openAgentDetail(name, chatOnly = false) {
  activeDetailAgent = name;
  activeChatAgent   = chatOnly ? name : null;
  // Toggle chat-only mode
  document.getElementById('agent-detail').classList.toggle('chat-mode', chatOnly);
  // Kick off a background model refresh (respects server-side TTL)
  refreshProviderModels();
  const agent = state.agents.find(a => a.name === name);
  const c = agent ? hat(agent.hatType) : hat('white');

  const nameInput = document.getElementById('agent-detail-name');
  nameInput.value = name;
  document.getElementById('agent-detail-hat').textContent  = agent ? hatLabel(agent.hatType) : '';
  document.getElementById('agent-detail-hat').style.color  = c.bar;

  // Set email address
  document.getElementById('agent-config-email').value = agent?.email || '';

  // Populate ticket chips for this agent
  const ticketsEl = document.getElementById('agent-detail-tickets');
  ticketsEl.innerHTML = '';
  const agentTickets = (state.tickets ?? []).filter(t =>
    t.assignee === name && t.column !== 'closed'
  );
  for (const t of agentTickets) {
    const chip = document.createElement('span');
    chip.className = 'agent-ticket-chip';
    chip.title = t.title;
    chip.textContent = `${t.id} ${t.title}`;
    ticketsEl.appendChild(chip);
  }

  document.getElementById('agent-detail-modal').hidden = false;

  const threadsEl = document.getElementById('agent-detail-threads');
  if (threadsEl) threadsEl.setAttribute('agent', name);

  // Unlock AudioContext inside the user gesture (click) so it can play later
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') audioCtx.resume();

  // Register speech interest for this agent
  getVoices().then(voices => {
    const current = findVoiceForAgent(name, voices);
    const speakerName = getSpeakerOverrides()[name] ?? null;
    setSpeechAgent(name, current, speakerName);
  });

  // Show avatar + apply background for this agent
  getAvatars().then(avatars => {
    const current = findAvatarForAgent(name);
    if (current && window.avatarAPI) {
      const bgFile = agentConfigs.get(name)?.background ?? null;
      window.avatarAPI.show(current.file, current.camera, current.rotate, current.fov, current.scale, bgFile);
    } else if (window.avatarAPI) {
      window.avatarAPI.hide();
    }
  });
  applyAvatarBackground(agentConfigs.get(name)?.background ?? null);

  // Populate per-agent MCP server checkboxes
  fetch('/api/mcp/catalogue')
    .then(r => r.json())
    .then(catalogue => {
      const enabledServers = catalogue.filter(e => e.enabled);
      const mcpLine = document.getElementById('agent-config-mcp-line');
      const mcpList = document.getElementById('agent-config-mcp-list');
      if (enabledServers.length === 0) { mcpLine.hidden = true; return; }
      mcpLine.hidden = false;
      const agentServers = agent?.enabledMcpServers; // undefined = all
      mcpList.innerHTML = '';
      for (const entry of enabledServers) {
        const checked = !agentServers || agentServers.includes(entry.id);
        const lbl = document.createElement('label');
        lbl.className = 'agent-config-mcp-item';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = entry.id;
        cb.checked = checked;
        lbl.appendChild(cb);
        lbl.append(' ' + entry.name);
        mcpList.appendChild(lbl);
      }
    })
    .catch(() => { document.getElementById('agent-config-mcp-line').hidden = true; });

  // Populate personal MCP configuration
  fetch(`/api/agents/${encodeURIComponent(name)}/personal-mcp`)
    .then(r => r.json())
    .then(entries => {
      const line = document.getElementById('agent-config-personal-mcp-line');
      const list = document.getElementById('agent-config-personal-mcp-list');
      if (!entries.length) { line.hidden = true; return; }
      line.hidden = false;
      list.innerHTML = '';
      for (const entry of entries) {
        list.appendChild(buildPersonalMcpEntry(name, entry));
      }
    })
    .catch(() => { document.getElementById('agent-config-personal-mcp-line').hidden = true; });

}

function parseFeatureOverrides(val) {
  const result = {};
  if (!val) return result;
  for (const part of val.split(',')) {
    const [k, v] = part.split(':');
    if (k && v) result[k.trim()] = v.trim() === 'on';
  }
  return result;
}

function serializeFeatureOverrides(checksMap) {
  const parts = [];
  for (const [key, { cb, defaultOn }] of Object.entries(checksMap)) {
    if (cb.checked !== defaultOn) parts.push(`${key}:${cb.checked ? 'on' : 'off'}`);
  }
  return parts.join(',');
}

function buildPersonalMcpEntry(agentName, entry) {
  const wrap = document.createElement('div');
  wrap.className = 'personal-mcp-entry';
  wrap.dataset.serverId = entry.id;

  const header = document.createElement('div');
  header.className = 'personal-mcp-header';

  const title = document.createElement('span');
  title.className = 'personal-mcp-title';
  title.textContent = entry.name;
  header.appendChild(title);

  if (entry.description) {
    const desc = document.createElement('span');
    desc.className = 'personal-mcp-desc';
    desc.textContent = entry.description;
    header.appendChild(desc);
  }
  if (entry.url) {
    const link = document.createElement('a');
    link.className = 'mcp-entry-link';
    link.href = entry.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.title = 'Setup docs ↗';
    link.textContent = 'docs ↗';
    header.appendChild(link);
  }
  wrap.appendChild(header);

  const fields = document.createElement('div');
  fields.className = 'personal-mcp-fields';
  const inputs = {};
  for (const varDef of (entry.envVars ?? [])) {
    const varName = typeof varDef === 'string' ? varDef : varDef.name;

    if (varDef.type === 'features' && varDef.features?.length) {
      const section = document.createElement('div');
      section.className = 'personal-mcp-features-section';
      const sectionLbl = document.createElement('div');
      sectionLbl.className = 'personal-mcp-field-label';
      sectionLbl.textContent = 'Features';
      section.appendChild(sectionLbl);
      const existing = parseFeatureOverrides(entry.credentials?.[varName] ?? '');
      const grid = document.createElement('div');
      grid.className = 'personal-mcp-features-grid';
      const checksMap = {};
      for (const feat of varDef.features) {
        const isOn = feat.key in existing ? existing[feat.key] : feat.defaultOn;
        const item = document.createElement('label');
        item.className = 'personal-mcp-feature-item';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = isOn;
        item.appendChild(cb);
        item.appendChild(document.createTextNode(' ' + feat.label));
        grid.appendChild(item);
        checksMap[feat.key] = { cb, defaultOn: feat.defaultOn };
      }
      section.appendChild(grid);
      fields.appendChild(section);
      inputs[varName] = { getValue: () => serializeFeatureOverrides(checksMap) };
    } else {
      const varHint = typeof varDef === 'string' ? varName : (varDef.placeholder ?? varName);
      const row = document.createElement('div');
      row.className = 'personal-mcp-field-row';
      const lbl = document.createElement('label');
      lbl.className = 'personal-mcp-field-label';
      lbl.textContent = varName;
      const inp = document.createElement('input');
      inp.type = varName.toLowerCase().includes('password') || varName.toLowerCase().includes('secret') ? 'password' : 'text';
      inp.className = 'personal-mcp-field-input';
      inp.value = entry.credentials?.[varName] ?? '';
      inp.placeholder = varHint;
      inp.autocomplete = 'off';
      row.appendChild(lbl);
      row.appendChild(inp);
      fields.appendChild(row);
      inputs[varName] = { getValue: () => inp.value.trim() };
    }
  }
  wrap.appendChild(fields);

  const actions = document.createElement('div');
  actions.className = 'personal-mcp-actions';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'personal-mcp-save-btn';
  saveBtn.textContent = entry.active ? 'Update' : 'Enable';
  saveBtn.onclick = async () => {
    const credentials = {};
    for (const [k, inp] of Object.entries(inputs)) credentials[k] = inp.getValue();
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentName)}/personal-mcp/${encodeURIComponent(entry.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentials }),
      });
      if (!res.ok) throw new Error(await res.text());
      saveBtn.textContent = 'Saved!';
      entry.active = true;
      disableBtn.hidden = false;
      setTimeout(() => { saveBtn.textContent = 'Update'; saveBtn.disabled = false; }, 1500);
    } catch (err) {
      saveBtn.textContent = 'Error';
      saveBtn.title = err.message;
      setTimeout(() => { saveBtn.textContent = entry.active ? 'Update' : 'Enable'; saveBtn.disabled = false; }, 2000);
    }
  };
  actions.appendChild(saveBtn);

  const disableBtn = document.createElement('button');
  disableBtn.className = 'personal-mcp-disable-btn';
  disableBtn.textContent = 'Disable';
  disableBtn.hidden = !entry.active;
  disableBtn.onclick = async () => {
    disableBtn.disabled = true;
    disableBtn.textContent = 'Disabling…';
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentName)}/personal-mcp/${encodeURIComponent(entry.id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(await res.text());
      entry.active = false;
      disableBtn.hidden = true;
      saveBtn.textContent = 'Enable';
      disableBtn.disabled = false;
    } catch (err) {
      disableBtn.textContent = 'Error';
      disableBtn.title = err.message;
      setTimeout(() => { disableBtn.textContent = 'Disable'; disableBtn.disabled = false; }, 2000);
    }
  };
  actions.appendChild(disableBtn);

  wrap.appendChild(actions);
  return wrap;
}

function closeAgentDetail() {
  clearSpeechQueue(activeDetailAgent);
  setSpeechAgent(null);
  activeDetailAgent = null;
  activeChatAgent   = null;
  document.getElementById('agent-detail').classList.remove('chat-mode');
  document.getElementById('agent-detail-modal').hidden = true;
  document.getElementById('agent-detail-threads')?.removeAttribute('agent');
  applyAvatarBackground(null);
  if (window.avatarAPI) window.avatarAPI.hide();
}

function appendAgentFeedEvent(agentName, _ev) {
  if (activeDetailAgent !== agentName) return;
  document.getElementById('agent-detail-threads')?._refresh();
}

function buildFeedItem(ev, selfName) {
  if (ev.type === 'tool_result' && toolCallDetail !== 'detailed') return null;
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
  tool_call:      { icon: '<img src="/assets/settings.svg" class="svg-icon svg-icon--feed" alt="">',  cls: 'tool',      label: 'Tool call'       },
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
  if (ev.type === 'tool_call') {
    return `Tool called: ${ev.tool}`;
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
      if (toolCallDetail !== 'detailed') return '';
      const args = ev.args ? JSON.stringify(ev.args, null, 2) : '';
      return args ? `<pre class="feed-pre">${esc(truncate(args, 300))}</pre>` : '';
    }
    case 'tool_result':
      if (toolCallDetail !== 'detailed') return '';
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

let cliInited    = false;
let cliReplyTarget = null; // agent name we're replying to, or null

function setCliReply(agentName) {
  cliReplyTarget = agentName;
  const bar   = document.getElementById('cli-reply-bar');
  const label = document.getElementById('cli-reply-label');
  if (!bar || !label) return;
  if (agentName) {
    label.textContent = `Replying to ${agentName}`;
    bar.hidden = false;
  } else {
    bar.hidden = true;
    label.textContent = '';
  }
  const input = document.getElementById('cli-input');
  if (input) {
    if (agentName && !input.value.startsWith(`@${agentName} `)) {
      input.value = `@${agentName} `;
    }
    input.focus();
    input.selectionStart = input.selectionEnd = input.value.length;
  }
}

function initCLI() {
  if (cliInited) return;
  cliInited = true;

  const input = document.getElementById('cli-input');
  if (!input) return;

  document.getElementById('cli-reply-cancel')?.addEventListener('click', () => {
    setCliReply(null);
    input.value = '';
    input.focus();
  });

  document.getElementById('chat-agent-select')?.addEventListener('change', updateChatThreads);
  updateChatAgentSelect();

  // ── @ mention menu ──────────────────────────────────────────────────
  let menuEl    = null;
  let menuIdx   = 0;
  let atStart   = -1; // index of '@' in input.value when menu opened

  function agentNames() {
    return (state.agents ?? []).map(a => a.name);
  }

  function filtered() {
    if (atStart < 0) return [];
    const fragment = input.value.slice(atStart + 1).toLowerCase();
    return agentNames().filter(n => n.toLowerCase().startsWith(fragment));
  }

  function closeMenu() {
    menuEl?.remove();
    menuEl  = null;
    atStart = -1;
    menuIdx = 0;
  }

  function renderMenu() {
    const items = filtered();
    if (!items.length) { closeMenu(); return; }

    if (!menuEl) {
      menuEl = document.createElement('div');
      menuEl.className = 'at-mention-menu';
      document.getElementById('cli-input-row').appendChild(menuEl);
    }

    const fragment = atStart >= 0 ? input.value.slice(atStart) : '@';
    menuEl.innerHTML = `<div class="at-mention-hint">@${fragment.slice(1) || '…'}  ↑↓ navigate · Enter select · Esc cancel</div>`;

    items.forEach((name, i) => {
      const el = document.createElement('div');
      el.className = 'at-mention-item' + (i === menuIdx ? ' selected' : '');
      el.innerHTML = `<span class="at-mention-arrow">▶</span><span>${name}</span>`;
      el.addEventListener('mousedown', e => {
        e.preventDefault(); // don't blur the input
        selectItem(name);
      });
      menuEl.appendChild(el);
    });
  }

  function selectItem(name) {
    if (atStart < 0) return;
    const before = input.value.slice(0, atStart);
    input.value  = before + '@' + name + ' ';
    closeMenu();
    input.focus();
  }

  // Open or update the menu whenever the value changes
  input.addEventListener('input', () => {
    const val    = input.value;
    const cursor = input.selectionStart ?? val.length;

    // Find the last '@' before the cursor with no space after it
    const segment = val.slice(0, cursor);
    const idx     = segment.lastIndexOf('@');

    if (idx >= 0 && !segment.slice(idx + 1).includes(' ')) {
      atStart = idx;
      menuIdx = 0;
      renderMenu();
    } else {
      closeMenu();
    }
  });

  input.addEventListener('keydown', e => {
    // Menu navigation
    if (menuEl) {
      const items = filtered();
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        menuIdx = Math.min(menuIdx + 1, items.length - 1);
        renderMenu();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        menuIdx = Math.max(menuIdx - 1, 0);
        renderMenu();
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (items[menuIdx]) { e.preventDefault(); selectItem(items[menuIdx]); return; }
      }
      if (e.key === 'Escape') { e.preventDefault(); closeMenu(); return; }
    }

    // Normal send on Enter
    if (e.key === 'Enter' && !menuEl) {
      const line = input.value.trim();
      if (!line) return;
      input.value = '';
      setCliReply(null);
      appendCLILine('> ' + line, 'cli-input-echo');

      fetch('/api/cli', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ line }),
      })
        .then(r => r.json())
        .then(data => { if (data.output) appendCLILine(data.output, 'cli-response'); })
        .catch(err => appendCLILine('Error: ' + err, 'cli-error'));
    }
  });

  // Close menu if user clicks outside
  document.addEventListener('click', e => {
    if (menuEl && !menuEl.contains(e.target) && e.target !== input) closeMenu();
  });
}

function updateChatAgentSelect() {
  const sel = document.getElementById('chat-agent-select');
  if (!sel) return;
  const prev = sel.value;
  const agents = state.agents ?? [];
  sel.innerHTML = '<option value="">— select agent —</option>';
  for (const a of agents) {
    const opt = document.createElement('option');
    opt.value = a.name;
    opt.textContent = a.name;
    sel.appendChild(opt);
  }
  if (prev && sel.querySelector(`option[value="${CSS.escape(prev)}"]`)) {
    sel.value = prev;
  } else if (agents.length) {
    sel.value = agents[0].name;
  }
  updateChatThreads();
}

function updateChatThreads() {
  const sel = document.getElementById('chat-agent-select');
  const el = document.getElementById('chat-threads');
  if (!sel || !el) return;
  const name = sel.value;
  if (name) el.setAttribute('agent', name);
  else el.removeAttribute('agent');
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

function appendCLIAgent(from, _content, _kind) {
  // Sync the chat threads selector to the speaking agent and trigger a refresh
  const sel = document.getElementById('chat-agent-select');
  if (sel && from && sel.value !== from) {
    const opt = sel.querySelector(`option[value="${CSS.escape(from)}"]`);
    if (opt) { sel.value = from; updateChatThreads(); }
  }
  document.getElementById('chat-threads')?._refresh();
}

// ── Tab switching ─────────────────────────────────────────────────────────────

function initTabs() {
  document.querySelectorAll('.panel-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.panel-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === tab + '-content'));
      if (tab === 'mcp')       fetchMCPCatalogue();
      if (tab === 'cli')       document.getElementById('cli-input')?.focus();
      if (tab === 'library')   fetchGlobalAgents();
      if (tab === 'schedules') fetchScheduledActions();
      const mcpEditBtn = document.getElementById('mcp-catalogue-edit-btn');
      if (mcpEditBtn) mcpEditBtn.hidden = (tab !== 'mcp');
    });
  });
}


// ── Settings modal ────────────────────────────────────────────────────────────

const ENV_META = {
  ANTHROPIC_API_KEY:  { label: 'Anthropic API Key',        group: 'API Keys',     secret: true,  hint: 'sk-ant-…'             },
  OPENAI_API_KEY:     { label: 'OpenAI API Key',            group: 'API Keys',     secret: true,  hint: 'sk-proj-…'            },
  GEMINI_API_KEY:     { label: 'Google Gemini API Key',     group: 'API Keys',     secret: true,  hint: 'AIzaSy…'              },
  BRAVE_API_KEY:      { label: 'Brave Search API Key',      group: 'API Keys',     secret: true,  hint: ''                     },
  ANTHROPIC_MODEL:    { label: 'Anthropic Default Model',   group: 'Models',       secret: false, hint: 'claude-haiku-4-5-20251001' },
  OPENAI_MODEL:       { label: 'OpenAI Default Model',      group: 'Models',       secret: false, hint: 'gpt-4.1-mini'              },
  GEMINI_MODEL:       { label: 'Gemini Default Model',      group: 'Models',       secret: false, hint: 'gemini-2.5-flash'           },
  OLLAMA_BASE_URL:    { label: 'Ollama Server URL',         group: 'Local Models', secret: false, hint: 'http://localhost:11434/v1'  },
  OLLAMA_MODEL:       { label: 'Ollama Default Model',      group: 'Local Models', secret: false, hint: 'llama3.2'                   },
  LM_STUDIO_BASE_URL: { label: 'LM Studio Server URL',      group: 'Local Models', secret: false, hint: 'http://localhost:1234/v1'   },
  LM_STUDIO_MODEL:    { label: 'LM Studio Default Model',   group: 'Local Models', secret: false, hint: 'model name from LM Studio'  },
};

const GROUP_ORDER = ['API Keys', 'Models', 'Local Models', 'Other'];

function initSettings() {
  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('mute-btn').addEventListener('click', toggleMute);
  document.getElementById('settings-close').addEventListener('click', closeSettings);
  document.getElementById('settings-cancel').addEventListener('click', closeSettings);
  document.getElementById('settings-save').addEventListener('click', saveSettings);
  document.getElementById('settings-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('settings-modal')) closeSettings();
    // Toggle slider buttons
    const opt = e.target.closest('.toggle-slider-opt');
    if (opt) {
      const slider = opt.closest('.toggle-slider');
      slider.querySelectorAll('.toggle-slider-opt').forEach(b => b.classList.remove('active'));
      opt.classList.add('active');
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !document.getElementById('settings-modal').hidden) closeSettings();
  });
}

function openSettings() {
  // Kick off a background model refresh (respects server-side TTL)
  refreshProviderModels();
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
    fetch('/api/project/human-name').then(r => r.json()).catch(() => ({ humanName: 'Human' })),
    fetch('/api/debug/logging').then(r => r.json()).catch(() => ({ logPrompts: false })),
  ])
    .then(([entries, providers, { humanName }, { logPrompts }]) => renderSettingsBody(entries, providers, humanName, logPrompts))
    .catch(() => { body.innerHTML = '<p class="settings-loading">Failed to load settings.</p>'; });
}

function renderSettingsBody(entries, providers, humanName, logPrompts) {
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

  let html = `
    <div class="settings-section">
      <div class="settings-section-title">Profile</div>
      <div class="env-field">
        <label class="env-label" for="setting-human-name">Your name</label>
        <input type="text" id="setting-human-name" class="env-input" data-setting="humanName"
               value="${esc(humanName ?? 'Human')}" placeholder="Human" autocomplete="off" spellcheck="false">
      </div>
      <div class="env-field env-field--toggle">
        <label class="env-label" for="setting-debug-logging">Prompt debug logging</label>
        <input type="checkbox" id="setting-debug-logging" data-setting="debugLogging"${logPrompts ? ' checked' : ''}>
      </div>
      <div class="env-field env-field--toggle">
        <label class="env-label" for="setting-tool-detail">Tool call detail</label>
        <div class="toggle-slider" id="setting-tool-detail" data-setting="toolCallDetail">
          <button class="toggle-slider-opt${toolCallDetail === 'simple'   ? ' active' : ''}" data-val="simple">Simple</button>
          <button class="toggle-slider-opt${toolCallDetail === 'detailed' ? ' active' : ''}" data-val="detailed">Detailed</button>
        </div>
      </div>
    </div>`;
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
    html += `<div class="settings-section"><div class="settings-section-title">Provider Status <button id="refresh-models-btn" class="modal-btn secondary" style="font-size:11px;padding:2px 8px;margin-left:8px">Refresh models</button><button id="update-pricing-btn" class="modal-btn secondary" style="font-size:11px;padding:2px 8px;margin-left:6px" title="Fetch current pricing from provider websites using Claude Haiku">Update pricing</button></div>`;
    for (const p of providers) {
      const dot = p.available ? '🟢' : '🔴';
      const modelCount = p.models?.length ? ` · ${p.models.length} model${p.models.length !== 1 ? 's' : ''}` : '';
      let note = p.available ? ` · ${esc(p.defaultModel ?? '')}${modelCount}` : ' · no API key set';
      if (p.baseUrlEnvKey) note = ` · ${esc(p.baseUrl || p.defaultBaseUrl || '')}${p.available ? modelCount : ' · offline'}`;
      html += `<div class="provider-status-row"><span>${dot} ${esc(p.label)}</span><span class="provider-status-note">${note}</span></div>`;
    }
    html += '</div>';
  }

  body.innerHTML = html;

  // Wire "Refresh models" button
  const refreshBtn = document.getElementById('refresh-models-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.disabled = true;
      refreshBtn.textContent = 'Refreshing…';
      _providersCache = null; // force reload of metadata too
      await refreshProviderModels(true);
      // Re-render the settings body with updated provider data
      openSettings();
    });
  }

  // Wire "Update pricing" button
  const updatePricingBtn = document.getElementById('update-pricing-btn');
  if (updatePricingBtn) {
    updatePricingBtn.addEventListener('click', async () => {
      updatePricingBtn.disabled = true;
      updatePricingBtn.textContent = 'Fetching…';
      try {
        const r = await fetch('/api/pricing/refresh', { method: 'POST' }).then(res => res.json());
        if (r.error) throw new Error(r.error);
        _pricingCache = null; // invalidate frontend pricing cache
        const summary = `+${r.added} added, ${r.updated} updated, ${r.unchanged} unchanged`;
        updatePricingBtn.textContent = `✓ ${summary}`;
        const msgEl = document.getElementById('settings-msg');
        if (msgEl) { msgEl.textContent = `Pricing updated: ${summary}`; msgEl.className = 'settings-msg settings-msg--ok'; }
      } catch (err) {
        updatePricingBtn.textContent = `✗ ${err.message}`;
      }
      setTimeout(() => {
        if (updatePricingBtn) { updatePricingBtn.disabled = false; updatePricingBtn.textContent = 'Update pricing'; }
      }, 6000);
    });
  }

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

  // Collect profile settings (data-setting attribute)
  const profileInputs = document.getElementById('settings-body').querySelectorAll('[data-setting]');
  const profileUpdates = {};
  profileInputs.forEach(inp => { profileUpdates[inp.dataset.setting] = inp.value; });

  const saveBtn = document.getElementById('settings-save');
  const msg     = document.getElementById('settings-msg');
  saveBtn.disabled = true;
  msg.textContent = '';

  const envSave = fetch('/api/env', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  }).then(r => r.json());

  const humanName = (profileUpdates['humanName'] ?? '').trim() || 'Human';
  const profileSave = fetch('/api/project/human-name', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ humanName }),
  }).then(r => r.json());

  const debugEnabled = document.getElementById('setting-debug-logging')?.checked ?? false;
  fetch('/api/debug/logging', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: debugEnabled }),
  }).catch(() => {});

  // Tool call detail is client-side only — persist to localStorage
  const toolDetailEl = document.getElementById('setting-tool-detail');
  if (toolDetailEl) {
    const chosen = toolDetailEl.querySelector('.toggle-slider-opt.active')?.dataset.val ?? 'simple';
    toolCallDetail = chosen;
    localStorage.setItem('toolCallDetail', chosen);
  }

  Promise.all([envSave, profileSave])
    .then(([res]) => {
      if (res.error) {
        msg.textContent = res.error;
        msg.className = 'settings-msg settings-msg--error';
      } else {
        msg.textContent = 'Saved.';
        msg.className = 'settings-msg settings-msg--ok';
        setTimeout(closeSettings, 800);
      }
    })
    .catch(() => {
      msg.textContent = 'Save failed.';
      msg.className = 'settings-msg settings-msg--error';
    })
    .finally(() => { saveBtn.disabled = false; });
}

// ── Goal bar ──────────────────────────────────────────────────────────────────

function updateGoalBar(goal, tickets) {
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

function initGoalBar() {
  const editBtn = document.getElementById('goal-edit-btn');
  const saveBtn = document.getElementById('goal-save-btn');
  const textEl  = document.getElementById('goal-text');
  const input   = document.getElementById('goal-input');
  if (!editBtn || !saveBtn || !textEl || !input) return;

  editBtn.addEventListener('click', () => {
    input.value = textEl.textContent;
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
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doSave(); if (e.key === 'Escape') { input.hidden = true; saveBtn.hidden = true; textEl.hidden = false; editBtn.hidden = false; } });
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

      // sort projects 
      projects = projects.sort((a, b) => a.id.localeCompare(b.id));

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

  if (activeDetailAgent) closeAgentDetail();

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
      // Apply state directly from response (SSE init may also arrive and re-apply idempotently)
      if (res.agents !== undefined) applyState({ agents: res.agents, tickets: res.tickets ?? [], humanName: res.project?.humanName ?? 'human' });
      if (res.project) updateProjectBadge(res.project.id, res.project.dir);
      updateGoalBar(res.project?.goal, res.tickets);
      fetchTools();
      fetchFiles();
      startFilesRefresh();
      fetchCalendar();
      fetch('/api/telemetry').then(r => r.json()).then(d => applyTelemetrySummary(d.summary)).catch(() => {});
    })
    .catch(() => {
      switchModal.hidden = true;
      badge.textContent = prevId;
    });
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
    const defaultModel = p?.defaultModel ?? '';
    populateModelSelect(document.getElementById('add-agent-model'), providers, 'anthropic', defaultModel);
    const lineEl = document.getElementById('lib-editor-pricing-line');
    const hintEl = document.getElementById('lib-editor-pricing-hint');
    updatePricingHint('anthropic', defaultModel, lineEl, hintEl);
    updateContextWindowPlaceholder(defaultModel);
  });
  document.getElementById('add-agent-provider').addEventListener('change', async () => {
    const pid = document.getElementById('add-agent-provider').value;
    let providers = await loadProviders();
    if (providers.find(p => p.id === pid)?.baseUrlEnvKey) {
      await refreshProviderModels();
      providers = _providersCache;
    }
    const p = providers.find(p => p.id === pid);
    populateModelSelect(document.getElementById('add-agent-model'), providers, pid, p?.defaultModel ?? '');
    const model = document.getElementById('add-agent-model').value;
    const lineEl = document.getElementById('lib-editor-pricing-line');
    const hintEl = document.getElementById('lib-editor-pricing-hint');
    updatePricingHint(pid, model, lineEl, hintEl);
    updateContextWindowPlaceholder(model);
  });
  document.getElementById('add-agent-model').addEventListener('change', () => {
    const pid   = document.getElementById('add-agent-provider').value;
    const model = document.getElementById('add-agent-model').value;
    const lineEl = document.getElementById('lib-editor-pricing-line');
    const hintEl = document.getElementById('lib-editor-pricing-hint');
    updatePricingHint(pid, model, lineEl, hintEl);
    updateContextWindowPlaceholder(model);
  });

  // Populate hat checkboxes
  populateHatGroup('add-agent-hat-group', ['white']);

  // Repopulate persona select when hat changes
  document.getElementById('add-agent-hat-group').addEventListener('change', () => {
    const hatType = getSelectedHats('add-agent-hat-group').filter(h => h !== 'none')[0] ?? 'none';
    populatePersonaSelect('add-agent-persona', hatType, '');
  });

  // Auto-fill fields when a persona is selected
  document.getElementById('add-agent-persona').addEventListener('change', () => {
    const hatType = getSelectedHats('add-agent-hat-group').filter(h => h !== 'none')[0] ?? 'none';
    const personaName = document.getElementById('add-agent-persona').value;
    const persona = (personasByHat[hatType] ?? []).find(p => p.name === personaName);
    if (persona) {
      document.getElementById('add-agent-name').value = persona.name;
      document.getElementById('add-agent-visual-desc').value = persona.visualDescription ?? '';
      document.getElementById('add-agent-backstory').value = persona.backstory ?? '';
      setSpecValue('add-agent-specialisation', 'add-agent-specialisation-custom', persona.specialisation);
    }
  });

  // Show/hide custom spec input when "Custom…" is selected
  document.getElementById('add-agent-specialisation').addEventListener('change', e => {
    const cust = document.getElementById('add-agent-specialisation-custom');
    cust.hidden = e.target.value !== '__custom__';
    if (!cust.hidden) cust.focus();
  });

  // Voice select — repopulate speakers when voice changes
  document.getElementById('add-agent-voice').addEventListener('change', () => {
    const voiceName  = document.getElementById('add-agent-voice').value;
    const speakerSel = document.getElementById('add-agent-speaker');
    getVoices().then(voices => {
      const voice = voices.find(v => v.name === voiceName);
      speakerSel.innerHTML = '<option value="">(default)</option>';
      if (voice?.speakers?.length) {
        const speakerNames = voice.speakers.map(s => typeof s === 'string' ? s : s.name)
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
        for (const sName of speakerNames) {
          const opt = document.createElement('option');
          opt.value = sName; opt.textContent = sName; speakerSel.appendChild(opt);
        }
        speakerSel.hidden = false;
      } else {
        speakerSel.hidden = true;
      }
    });
  });

  // Voice preview button
  document.getElementById('add-agent-preview-voice').addEventListener('click', async () => {
    const voiceName   = document.getElementById('add-agent-voice').value || undefined;
    const speakerName = document.getElementById('add-agent-speaker').value || undefined;
    const btn = document.getElementById('add-agent-preview-voice');
    btn.disabled = true; btn.textContent = '…';
    try {
      const res = await fetch('/api/speech/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice: voiceName, speakerName }),
      });
      if (res.ok) {
        const buf = await res.arrayBuffer();
        if (!audioCtx) audioCtx = new AudioContext();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const audio = await audioCtx.decodeAudioData(buf);
        const src = audioCtx.createBufferSource();
        src.buffer = audio; src.connect(audioCtx.destination); src.start();
      }
    } catch { /* ignore */ }
    btn.innerHTML = '<img src="/assets/play.svg" class="svg-icon" alt="Play">'; btn.disabled = false;
  });

  // Avatar select — live preview
  document.getElementById('add-agent-avatar').addEventListener('change', () => {
    const file  = document.getElementById('add-agent-avatar').value;
    const bg    = document.getElementById('add-agent-background').value || null;
    const panel = document.getElementById('lib-avatar-panel');
    if (file) {
      panel.hidden = false;
      getAvatars().then(avatars => {
        const av = avatars.find(a => a.file === file);
        if (av && window.avatarAPI) {
          window.avatarAPI.show(av.file, av.camera, av.rotate, av.fov, av.scale, bg, 'lib-avatar-panel', 'lib-avatar-canvas');
        }
      });
    } else {
      panel.hidden = true;
      window.avatarAPI?.hide('lib-avatar-panel');
    }
  });

  // Background select — live preview
  document.getElementById('add-agent-background').addEventListener('change', () => {
    const bg    = document.getElementById('add-agent-background').value || null;
    const panel = document.getElementById('lib-avatar-panel');
    if (panel) {
      panel.style.backgroundImage = bg ? `url('/backgrounds/${encodeURIComponent(bg)}')` : '';
    }
    // Also update avatar if one is shown
    const avatarFile = document.getElementById('add-agent-avatar').value;
    if (avatarFile && window.avatarAPI) {
      getAvatars().then(avatars => {
        const av = avatars.find(a => a.file === avatarFile);
        if (av) window.avatarAPI.show(av.file, av.camera, av.rotate, av.fov, av.scale, bg, 'lib-avatar-panel', 'lib-avatar-canvas');
      });
    }
  });

  // Generate background button
  document.getElementById('add-agent-gen-bg').addEventListener('click', () => {
    document.getElementById('gen-bg-prompt').value = '';
    document.getElementById('gen-bg-error').textContent = '';
    document.getElementById('gen-bg-preview').hidden = true;
    document.getElementById('gen-bg-spinner').hidden = true;
    document.getElementById('gen-bg-submit').disabled = false;
    document.getElementById('gen-bg-modal').hidden = false;
    document.getElementById('gen-bg-prompt').focus();
  });

  // Prompt preview button (shown in edit mode only)
  document.getElementById('add-agent-prompt-btn').addEventListener('click', openLibraryPromptPreview);

  // Close lib prompt preview
  document.getElementById('lib-prompt-close').addEventListener('click', () => {
    document.getElementById('lib-prompt-preview').hidden = true;
  });
  // Close on overlay click (ignore clicks on the prompt preview panel sibling)
  document.getElementById('add-agent-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeAddAgent();
  });
}

let _agentEditorMode = 'new'; // 'new' | 'edit'
let _libEditAgentId = null;

async function openLibraryPromptPreview() {
  const name        = document.getElementById('add-agent-name').value.trim() || 'Agent';
  const hats        = getSelectedHats('add-agent-hat-group');
  const specialisation = (() => {
    const sel = document.getElementById('add-agent-specialisation').value;
    if (sel === '__custom__') return document.getElementById('add-agent-specialisation-custom').value.trim();
    return sel;
  })();
  const backstory       = document.getElementById('add-agent-backstory').value.trim();
  const visualDescription = document.getElementById('add-agent-visual-desc').value.trim();

  const params = new URLSearchParams({ name, backstory, specialisation, visualDescription });
  for (const h of hats) params.append('hat', h);

  const textEl   = document.getElementById('lib-prompt-text');
  const lengthEl = document.getElementById('lib-prompt-length');
  textEl.textContent = 'Loading…';
  lengthEl.textContent = '';
  document.getElementById('lib-prompt-preview').hidden = false;

  try {
    const res  = await fetch(`/api/prompt-preview?${params}`);
    const data = await res.json();
    const text = data.prompt ?? '';
    textEl.textContent = text;
    const chars = text.length;
    const tokens = Math.round(chars / 4);
    lengthEl.textContent = `~${tokens.toLocaleString()} tokens (${chars.toLocaleString()} chars)`;
  } catch (err) {
    textEl.textContent = `Error: ${err.message}`;
  }
}

function openAddAgent() {
  _agentEditorMode = 'new';
  _libEditAgentId = null;
  document.getElementById('add-agent-modal-title').textContent = 'Add Agent';
  document.getElementById('add-agent-save').textContent = 'Add Agent';
  document.getElementById('add-agent-prompt-btn').hidden = true;
  document.getElementById('add-agent-name').value = '';
  document.getElementById('add-agent-visual-desc').value = '';
  document.getElementById('add-agent-backstory').value = '';
  getAvatars().then(avatars => {
    const sel = document.getElementById('add-agent-avatar');
    sel.innerHTML = '<option value="">(no avatar)</option>';
    for (const av of avatars) {
      const opt = document.createElement('option');
      opt.value = av.file; opt.textContent = av.name;
      sel.appendChild(opt);
    }
  });
  populateBackgroundSelect('', 'add-agent-background');
  getVoices().then(voices => {
    const voiceSel = document.getElementById('add-agent-voice');
    voiceSel.innerHTML = '<option value="">(no voice)</option>';
    for (const v of voices) {
      const opt = document.createElement('option');
      opt.value = v.name; opt.textContent = v.name + (v.speakers?.length ? ` [${v.speakers.length} spk]` : '');
      voiceSel.appendChild(opt);
    }
  });
  document.getElementById('add-agent-speaker').innerHTML = '<option value="">(default)</option>';
  document.getElementById('add-agent-speaker').hidden = true;
  setSpecValue('add-agent-specialisation', 'add-agent-specialisation-custom', '');
  document.getElementById('add-agent-error').textContent = '';
  document.getElementById('add-agent-schedules-section').hidden = true;
  document.getElementById('add-agent-persona-group').hidden = false;
  const maxCtxOpenEl  = document.getElementById('add-agent-max-context');
  const maxCostOpenEl = document.getElementById('add-agent-max-cost');
  if (maxCtxOpenEl)  maxCtxOpenEl.value  = '';
  if (maxCostOpenEl) maxCostOpenEl.value = '';
  document.getElementById('lib-editor-pricing-line').hidden = true;
  document.getElementById('lib-avatar-panel').hidden = false;
  const hatType = getSelectedHats('add-agent-hat-group').filter(h => h !== 'none')[0] ?? 'none';
  populatePersonaSelect('add-agent-persona', hatType, '');
  document.getElementById('add-agent-modal').hidden = false;
  document.getElementById('add-agent-name').focus();
}

async function openLibraryEdit(agent) {
  _agentEditorMode = 'edit';
  _libEditAgentId = agent.id;
  document.getElementById('add-agent-modal-title').textContent = 'Edit Agent';
  document.getElementById('add-agent-save').textContent = 'Save';
  document.getElementById('add-agent-error').textContent = '';
  document.getElementById('add-agent-prompt-btn').hidden = false;
  document.getElementById('add-agent-persona-group').hidden = true;

  document.getElementById('add-agent-name').value = agent.identity?.name ?? '';
  document.getElementById('add-agent-visual-desc').value = agent.identity?.visualDescription ?? '';
  document.getElementById('add-agent-backstory').value = agent.identity?.backstory ?? '';
  populateHatGroup('add-agent-hat-group', agent.hatType ?? ['none']);
  setSpecValue('add-agent-specialisation', 'add-agent-specialisation-custom', agent.identity?.specialisation ?? '');

  const provSel  = document.getElementById('add-agent-provider');
  const modelSel = document.getElementById('add-agent-model');
  const providers = await loadProviders();
  const providerName = agent.providerName ?? 'anthropic';
  populateProviderSelect(provSel, providers, providerName);
  populateModelSelect(modelSel, providers, providerName, agent.model ?? '');

  // Update pricing hint and context window placeholder for the current model
  const pricingLineEl = document.getElementById('lib-editor-pricing-line');
  const pricingHintEl = document.getElementById('lib-editor-pricing-hint');
  updatePricingHint(providerName, agent.model ?? '', pricingLineEl, pricingHintEl);
  updateContextWindowPlaceholder(agent.model ?? '');

  // Populate new config fields
  const maxCtxEl  = document.getElementById('add-agent-max-context');
  const maxCostEl = document.getElementById('add-agent-max-cost');
  if (maxCtxEl)  maxCtxEl.value  = agent.maxContextTokens != null ? String(agent.maxContextTokens) : '';
  if (maxCostEl) maxCostEl.value = agent.maxCostPerHour   != null ? String(agent.maxCostPerHour)   : '';

  // Avatar — populate then show preview if one is set
  const avatarSel  = document.getElementById('add-agent-avatar');
  const currentAvatar = agent.identity?.avatar ?? '';
  const currentBg     = agent.identity?.background ?? '';
  document.getElementById('lib-avatar-panel').hidden = true;
  getAvatars().then(avatars => {
    avatarSel.innerHTML = '<option value="">(no avatar)</option>';
    for (const av of avatars) {
      const opt = document.createElement('option');
      opt.value = av.file; opt.textContent = av.name;
      avatarSel.appendChild(opt);
    }
    avatarSel.value = currentAvatar;
    if (currentAvatar && window.avatarAPI) {
      const av = avatars.find(a => a.file === currentAvatar);
      if (av) {
        document.getElementById('lib-avatar-panel').hidden = false;
        window.avatarAPI.show(av.file, av.camera, av.rotate, av.fov, av.scale, currentBg || null, 'lib-avatar-panel', 'lib-avatar-canvas');
      }
    }
  });

  // Background
  populateBackgroundSelect(currentBg, 'add-agent-background');

  // Voice
  const voiceSel   = document.getElementById('add-agent-voice');
  const speakerSel = document.getElementById('add-agent-speaker');
  getVoices().then(voices => {
    voiceSel.innerHTML = '<option value="">(no voice)</option>';
    for (const v of voices) {
      const opt = document.createElement('option');
      opt.value = v.name; opt.textContent = v.name + (v.speakers?.length ? ` [${v.speakers.length} spk]` : '');
      voiceSel.appendChild(opt);
    }
    const currentVoice = agent.identity?.voice ?? '';
    voiceSel.value = currentVoice;
    // Populate speakers for the current voice
    const voice = voices.find(v => v.name === currentVoice);
    speakerSel.innerHTML = '<option value="">(default)</option>';
    if (voice?.speakers?.length) {
      const speakerNames = voice.speakers.map(s => typeof s === 'string' ? s : s.name)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
      for (const sName of speakerNames) {
        const opt = document.createElement('option');
        opt.value = sName; opt.textContent = sName; speakerSel.appendChild(opt);
      }
      speakerSel.value = agent.identity?.speakerName ?? '';
      speakerSel.hidden = false;
    } else {
      speakerSel.hidden = true;
    }
  });

  // Populate scheduled actions checklist
  const schedSection = document.getElementById('add-agent-schedules-section');
  const schedList    = document.getElementById('add-agent-schedules-list');
  try {
    const actions = await fetch('/api/scheduled-actions').then(r => r.json());
    const assigned = new Set(agent.scheduledActionIds ?? []);
    if (actions.length === 0) {
      schedList.innerHTML = '<span style="color:var(--text-muted);font-size:12px">No global scheduled actions defined yet.</span>';
    } else {
      schedList.innerHTML = actions.map(a => `
        <label class="add-agent-sched-label">
          <input type="checkbox" class="add-agent-sched-cb" value="${escHtml(a.id)}"${assigned.has(a.id) ? ' checked' : ''}>
          <span>${escHtml(a.label)}</span>
        </label>`).join('');
    }
    schedSection.hidden = false;
  } catch {
    schedSection.hidden = true;
  }

  document.getElementById('add-agent-modal').hidden = false;
  document.getElementById('add-agent-name').focus();
}

function closeAddAgent() {
  window.avatarAPI?.hide('lib-avatar-panel');
  document.getElementById('lib-avatar-panel').hidden = true;
  document.getElementById('lib-prompt-preview').hidden = true;
  document.getElementById('add-agent-modal').hidden = true;
}

async function saveAddAgent() {
  const name              = document.getElementById('add-agent-name').value.trim();
  const hatTypes          = getSelectedHats('add-agent-hat-group');
  const hatType           = hatTypes.filter(h => h !== 'none')[0] ?? 'none';
  const specialisation    = getSpecValue('add-agent-specialisation', 'add-agent-specialisation-custom');
  const provider          = document.getElementById('add-agent-provider').value;
  const model             = document.getElementById('add-agent-model').value;
  const visualDescription = document.getElementById('add-agent-visual-desc').value.trim();
  const backstory         = document.getElementById('add-agent-backstory').value.trim();
  const avatar            = document.getElementById('add-agent-avatar').value || null;
  const voice             = document.getElementById('add-agent-voice').value || null;
  const speakerName       = document.getElementById('add-agent-speaker').value || null;
  const background        = document.getElementById('add-agent-background').value || null;
  const maxContextRaw     = document.getElementById('add-agent-max-context')?.value?.trim();
  const maxCostRaw        = document.getElementById('add-agent-max-cost')?.value?.trim();
  const maxContextTokens  = maxContextRaw ? (parseInt(maxContextRaw, 10) || null) : null;
  const maxCostPerHour    = maxCostRaw    ? (parseFloat(maxCostRaw)      || null) : null;
  const errEl             = document.getElementById('add-agent-error');
  errEl.textContent       = '';
  if (!name) { errEl.textContent = 'Name is required.'; return; }
  const btn = document.getElementById('add-agent-save');
  btn.disabled = true; btn.textContent = '…';

  try {
    if (_agentEditorMode === 'edit' && _libEditAgentId) {
      const body = { name, hatTypes, visualDescription, backstory, specialisation, provider, model, avatar, voice, speakerName, background, maxContextTokens, maxCostPerHour };
      const r = await fetch(`/api/global-agents/${encodeURIComponent(_libEditAgentId)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!r.ok) { const e = await r.json(); errEl.textContent = e.error ?? 'Save failed'; btn.disabled = false; btn.textContent = 'Save'; return; }

      // Sync scheduled action assignments
      const checkboxes = document.querySelectorAll('#add-agent-schedules-list .add-agent-sched-cb:checked');
      const scheduledActionIds = Array.from(checkboxes).map(cb => cb.value);
      await fetch(`/api/global-agents/${encodeURIComponent(_libEditAgentId)}/scheduled-actions`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scheduledActionIds }),
      });

      closeAddAgent();
      fetchGlobalAgents();
    } else {
      const personaName = document.getElementById('add-agent-persona').value;
      const persona = (personasByHat[hatType] ?? []).find(p => p.name === personaName);
      const res = await fetch('/api/agents', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, hatTypes,
          visualDescription: visualDescription || persona?.visualDescription || undefined,
          backstory:         backstory || persona?.backstory || undefined,
          specialisation:    specialisation || persona?.specialisation || undefined,
          provider, model,
        }),
      }).then(r => r.json());
      if (res.error) { errEl.textContent = res.error; }
      else { closeAddAgent(); }
    }
  } catch { errEl.textContent = 'Failed to save agent.'; }

  btn.disabled = false;
  btn.textContent = _agentEditorMode === 'edit' ? 'Save' : 'Add Agent';
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

// ── Meeting detail modal (click on grid event) ────────────────────────────────

let _meetingDetailId = null;

function showMeetingPopup(id) {
  const m = calMeetings.find(x => x.id === id);
  if (!m) return;
  _meetingDetailId = id;

  const when = m.scheduledFor
    ? new Date(m.scheduledFor).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : (m.startedAt ? new Date(m.startedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');
  const parts = [m.facilitator, ...(m.participants || [])];
  const people = [...new Set(parts)].join(', ');

  document.getElementById('meeting-detail-topic').textContent = m.topic;
  document.getElementById('meeting-detail-time').textContent = when;
  document.getElementById('meeting-detail-people').textContent = people;
  document.getElementById('meeting-detail-agenda').textContent = m.agenda || '';
  document.getElementById('meeting-detail-agenda').hidden = !m.agenda;
  document.getElementById('meeting-detail-status').textContent = m.status;
  document.getElementById('meeting-detail-status').className = `meeting-detail-status status-${m.status}`;

  document.getElementById('meeting-detail-launch-btn').hidden = m.status !== 'scheduled';
  document.getElementById('meeting-detail-cancel-btn').hidden = m.status !== 'scheduled';
  document.getElementById('meeting-detail-delete-btn').hidden = m.status === 'scheduled';
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

async function deleteMeeting(id) {
  try {
    const res = await fetch(`/api/scheduled-meetings/${id}`, { method: 'DELETE' }).then(r => r.json());
    if (res.error) alert(res.error);
    else fetchCalendar();
  } catch { alert('Failed to delete meeting.'); }
}

// ── Minutes modal ─────────────────────────────────────────────────────────────

async function openMinutes(meetingId, topic) {
  document.getElementById('minutes-modal-title').textContent = `Minutes: ${topic}`;
  document.getElementById('minutes-modal-content').textContent = 'Loading…';
  document.getElementById('minutes-modal').hidden = false;
  try {
    const res = await fetch(`/api/meetings/${encodeURIComponent(meetingId)}/minutes`);
    const data = await res.json();
    document.getElementById('minutes-modal-content').textContent = data.markdown ?? data.error ?? 'No content.';
  } catch {
    document.getElementById('minutes-modal-content').textContent = 'Failed to load minutes.';
  }
}

function closeMinutes() {
  document.getElementById('minutes-modal').hidden = true;
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

  // Meeting detail modal
  document.getElementById('meeting-detail-close')?.addEventListener('click', closeMeetingDetail);
  document.getElementById('meeting-detail-modal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeMeetingDetail();
  });
  document.getElementById('meeting-detail-launch-btn')?.addEventListener('click', async () => {
    const id = _meetingDetailId; closeMeetingDetail();
    await launchMeetingNow(id);
  });
  document.getElementById('meeting-detail-cancel-btn')?.addEventListener('click', async () => {
    const id = _meetingDetailId; closeMeetingDetail();
    await cancelMeeting(id);
  });
  document.getElementById('meeting-detail-delete-btn')?.addEventListener('click', async () => {
    const id = _meetingDetailId; closeMeetingDetail();
    await deleteMeeting(id);
  });
  document.getElementById('meeting-detail-minutes-btn')?.addEventListener('click', () => {
    const m = calMeetings.find(x => x.id === _meetingDetailId);
    if (m?.meetingId) openMinutes(m.meetingId, m.topic);
  });

  // Minutes modal
  document.getElementById('minutes-modal-close')?.addEventListener('click', closeMinutes);
  document.getElementById('minutes-modal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeMinutes();
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

// ── Impromptu Meeting ─────────────────────────────────────────────────────────

function openImpromptuMeeting() {
  // Reset fields
  document.getElementById('impromptu-topic').value = '';
  document.getElementById('impromptu-agenda').value = '';
  document.getElementById('impromptu-error').textContent = '';

  // Populate facilitator select — prefer first Blue Hat agent
  const facilitatorSel = document.getElementById('impromptu-facilitator');
  facilitatorSel.innerHTML = '';
  const agents = state.agents ?? [];
  const blue = agents.filter(a => a.hatType === 'blue');
  const others = agents.filter(a => a.hatType !== 'blue');
  for (const a of [...blue, ...others]) {
    const opt = document.createElement('option');
    opt.value = a.name; opt.textContent = `${a.name} (${a.hatType})`;
    facilitatorSel.appendChild(opt);
  }

  // Populate participants grid — all checked by default (including human)
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
  const errEl      = document.getElementById('impromptu-error');
  const topic      = document.getElementById('impromptu-topic').value.trim();
  const agenda     = document.getElementById('impromptu-agenda').value.trim();
  const facilitator = document.getElementById('impromptu-facilitator').value;
  // Facilitator is passed separately — exclude from participants to avoid duplication
  const participants = [...document.querySelectorAll('#impromptu-participants input:checked')]
    .map(cb => cb.value).filter(n => n !== facilitator);
  errEl.textContent = '';

  if (!topic) { errEl.textContent = 'Topic is required.'; return; }
  if (!facilitator) { errEl.textContent = 'At least one agent is needed to facilitate.'; return; }

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

function initImpromptuMeeting() {
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

// ── Push-to-talk (Whisper STT) ────────────────────────────────────────────────

/**
 * Wire a mic button to an input field.
 * Hold the button (mousedown/touchstart) to record; release to transcribe.
 * The transcript is appended to the input value (so typed text is preserved).
 */
function initMicBtn(btnId, inputId) {
  const btn = document.getElementById(btnId);
  const inp = document.getElementById(inputId);
  if (!btn || !inp) return;

  let mediaRecorder = null;
  let chunks = [];

  function setState(state) {
    btn.classList.toggle('recording',   state === 'recording');
    btn.classList.toggle('processing',  state === 'processing');
    btn.disabled = state === 'processing';
    btn.title = state === 'recording'  ? 'Release to transcribe'
              : state === 'processing' ? 'Transcribing…'
              : 'Hold to speak (Whisper)';
  }

  async function startRecording() {
    chunks = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      mediaRecorder.start();
      setState('recording');
    } catch (err) {
      console.warn('[mic] getUserMedia failed:', err);
      setState('idle');
    }
  }

  async function stopAndTranscribe() {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') { setState('idle'); return; }
    setState('processing');

    await new Promise(resolve => {
      mediaRecorder.onstop = resolve;
      mediaRecorder.stop();
      mediaRecorder.stream.getTracks().forEach(t => t.stop());
    });

    if (chunks.length === 0) { setState('idle'); return; }

    try {
      const mimeType = chunks[0].type || 'audio/webm';
      const blob = new Blob(chunks, { type: mimeType });
      const res = await fetch('/api/speech/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': mimeType },
        body: blob,
      });
      const data = await res.json();
      if (data.text) {
        const sep = inp.value && !inp.value.endsWith(' ') ? ' ' : '';
        inp.value += sep + data.text;
        inp.focus();
      }
    } catch (err) {
      console.warn('[mic] transcription failed:', err);
    }

    setState('idle');
    mediaRecorder = null;
    chunks = [];
  }

  // Mouse events
  btn.addEventListener('mousedown', e => { e.preventDefault(); startRecording(); });
  window.addEventListener('mouseup', () => { if (mediaRecorder?.state === 'recording') stopAndTranscribe(); });

  // Touch events (mobile)
  btn.addEventListener('touchstart', e => { e.preventDefault(); startRecording(); }, { passive: false });
  window.addEventListener('touchend', () => { if (mediaRecorder?.state === 'recording') stopAndTranscribe(); });
}

function initMicButtons() {
  initMicBtn('cli-mic-btn',     'cli-input');
  initMicBtn('meeting-mic-btn', 'meeting-input');
}

initProjectBadge();
initGoalBar();
initSettings();
initAddAgent();
initAgentChat();
loadSpecialisations();
loadPersonas();
initMCPEditor();
initImpromptuMeeting();
initCalendar();
initMicButtons();
initBacklogCalendarTabs();
initPanelExpand();
initTelemetry();
initTelScopeToggle();
initFileUpload();
initFileViewer();
initGenBgModal();
initLibraryTab();
initSchedulesTab();
connect();

// ── Panel expand / restore ────────────────────────────────────────────────────

function collapseExpandedPanel() {
  document.querySelectorAll('section.panel--expanded').forEach(p => {
    p.classList.remove('panel--expanded');
    p.style.top = '';
    const b = p.querySelector('.panel-expand-btn');
    if (b) b.innerHTML = '<img src="/assets/expand.svg" class="svg-icon" alt="Expand">';
  });
  document.body.classList.remove('has-expanded-panel');
}

function initPanelExpand() {
  document.querySelectorAll('.panel-expand-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const panelId = btn.dataset.panel;
      const panel = document.getElementById(panelId);
      if (!panel) return;
      const isExpanded = panel.classList.contains('panel--expanded');
      collapseExpandedPanel();
      if (!isExpanded) {
        panel.classList.add('panel--expanded');
        // Pin the top to the actual bottom of the chrome above main so the
        // panel never overlaps the header or goal bar regardless of their heights.
        const mainEl = document.querySelector('main');
        if (mainEl) panel.style.top = mainEl.getBoundingClientRect().top + 'px';
        btn.innerHTML = '<img src="/assets/reduce.svg" class="svg-icon" alt="Collapse">'; // reduce — restore to normal
        document.body.classList.add('has-expanded-panel');
      }
    });
  });

  // Escape collapses any expanded panel
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.body.classList.contains('has-expanded-panel')) {
      collapseExpandedPanel();
    }
  });
}

// ── LLM Telemetry ────────────────────────────────────────────────────────────

const PIE_COLORS = [
  '#58a6ff','#3fb950','#e3b341','#f85149','#8957e5',
  '#39d353','#db6d28','#a5d6ff','#7ee787','#ffa657',
];

function fmtTokens(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

let telScope = 'project'; // 'project' | 'all'

function applyTelemetrySummary(summary) {
  if (!summary) return;
  document.getElementById('tel-in').textContent   = fmtTokens(summary.totalInputTokens  ?? 0);
  document.getElementById('tel-out').textContent  = fmtTokens(summary.totalOutputTokens ?? 0);
  document.getElementById('tel-cost').textContent = '$' + (summary.totalCost ?? 0).toFixed(4);
}

function refreshTelemetryBar() {
  const url = telScope === 'all' ? '/api/telemetry/all' : '/api/telemetry';
  fetch(url).then(r => r.json()).then(d => { if (d.summary) applyTelemetrySummary(d.summary); }).catch(() => {});
}

function initTelScopeToggle() {
  const btn = document.getElementById('tel-scope-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    telScope = telScope === 'project' ? 'all' : 'project';
    btn.textContent = telScope === 'all' ? 'All time' : 'Project';
    btn.classList.toggle('tel-scope-btn--all', telScope === 'all');
    refreshTelemetryBar();
  });
}

function drawPie(canvas, data) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2, r = Math.min(cx, cy) - 4;
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) {
    ctx.fillStyle = '#30363d';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    return;
  }
  let angle = -Math.PI / 2;
  data.forEach((d, i) => {
    const slice = (d.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, angle, angle + slice);
    ctx.closePath();
    ctx.fillStyle = PIE_COLORS[i % PIE_COLORS.length];
    ctx.fill();
    angle += slice;
  });
}

function buildHourlyBuckets(records, days = 7) {
  const now = Date.now();
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  const buckets = new Map();
  for (const r of records) {
    const ts = new Date(r.ts).getTime();
    if (ts < cutoff) continue;
    const d = new Date(ts);
    d.setMinutes(0, 0, 0, 0);
    const key = d.getTime();
    if (!buckets.has(key)) buckets.set(key, {});
    const b = buckets.get(key);
    if (!b[r.agent]) b[r.agent] = { cost: 0, calls: 0 };
    b[r.agent].cost += r.cost;
    b[r.agent].calls++;
  }
  const startD = new Date(cutoff);
  startD.setMinutes(0, 0, 0, 0);
  const slots = [];
  for (let ms = startD.getTime(); ms <= now + 3_600_000; ms += 3_600_000) {
    slots.push({ hour: new Date(ms), data: buckets.get(ms) ?? {} });
  }
  return slots;
}

function renderHourlyChart(records) {
  const canvas = document.getElementById('tel-hourly-canvas');
  const tooltip = document.getElementById('tel-hourly-tooltip');
  if (!canvas) return;

  const BAR_W = 8, BAR_GAP = 2, SLOT_W = BAR_W + BAR_GAP;
  const AXIS_LEFT = 44, AXIS_BOTTOM = 24, TOP_PAD = 8, CHART_H = 120;
  const slots = buildHourlyBuckets(records ?? [], 7);

  canvas.width  = AXIS_LEFT + slots.length * SLOT_W;
  canvas.height = TOP_PAD + CHART_H + AXIS_BOTTOM;

  const agentSet = new Set();
  for (const s of slots) Object.keys(s.data).forEach(a => agentSet.add(a));
  const agents = [...agentSet].sort();
  const agentColor = Object.fromEntries(agents.map((a, i) => [a, PIE_COLORS[i % PIE_COLORS.length]]));

  let maxCost = 0;
  for (const s of slots) {
    const total = Object.values(s.data).reduce((n, d) => n + d.cost, 0);
    if (total > maxCost) maxCost = total;
  }
  if (!maxCost) maxCost = 0.001;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Gridlines and y-axis labels
  const TICK_COUNT = 4;
  for (let t = 0; t <= TICK_COUNT; t++) {
    const frac = t / TICK_COUNT;
    const y = TOP_PAD + CHART_H - frac * CHART_H;
    const val = maxCost * frac;
    const label = val >= 0.01 ? '$' + val.toFixed(2) : val > 0 ? '$' + val.toFixed(4) : '$0';
    ctx.fillStyle = '#6e7681';
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(label, AXIS_LEFT - 4, y + 3);
    ctx.strokeStyle = t === 0 ? '#30363d' : '#21262d';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(AXIS_LEFT, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  // Bars (stacked by agent)
  for (let i = 0; i < slots.length; i++) {
    const x = AXIS_LEFT + i * SLOT_W;
    let yBottom = TOP_PAD + CHART_H;
    for (const agent of agents) {
      const entry = slots[i].data[agent];
      if (!entry) continue;
      const h = Math.max(1, (entry.cost / maxCost) * CHART_H);
      ctx.fillStyle = agentColor[agent];
      ctx.fillRect(x, yBottom - h, BAR_W, h);
      yBottom -= h;
    }
  }

  // X-axis day labels every 24 slots
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  ctx.fillStyle = '#6e7681';
  ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (let i = 0; i < slots.length; i += 24) {
    const d = slots[i].hour;
    const label = DAY_NAMES[d.getDay()] + ' ' + d.getDate();
    const xCenter = AXIS_LEFT + i * SLOT_W + 12 * SLOT_W;
    ctx.fillText(label, xCenter, TOP_PAD + CHART_H + 16);
    ctx.strokeStyle = '#30363d';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(AXIS_LEFT + i * SLOT_W, TOP_PAD + CHART_H);
    ctx.lineTo(AXIS_LEFT + i * SLOT_W, TOP_PAD + CHART_H + 5);
    ctx.stroke();
  }

  // Hourly legend
  const legendEl = document.getElementById('tel-hourly-legend');
  if (legendEl) {
    legendEl.innerHTML = agents.map(a =>
      `<div class="tel-legend-item"><span class="tel-legend-dot" style="background:${agentColor[a]}"></span><span class="tel-legend-label">${esc(a)}</span></div>`
    ).join('');
  }

  // Tooltip on hover
  const wrap = canvas.closest('.tel-hourly-scroll');
  canvas.onmousemove = (e) => {
    if (!tooltip) return;
    const rect = canvas.getBoundingClientRect();
    const slotIdx = Math.floor((e.clientX - rect.left - AXIS_LEFT) / SLOT_W);
    if (slotIdx < 0 || slotIdx >= slots.length) { tooltip.hidden = true; return; }
    const slot = slots[slotIdx];
    const total = Object.values(slot.data).reduce((n, d) => n + d.cost, 0);
    if (!total) { tooltip.hidden = true; return; }
    const timeStr = slot.hour.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit' });
    const rows = agents.filter(a => slot.data[a]).map(a =>
      `<div class="tel-tip-row"><span class="tel-tip-dot" style="background:${agentColor[a]}"></span><span>${esc(a)}</span><span>$${slot.data[a].cost.toFixed(4)}</span></div>`
    ).join('');
    tooltip.innerHTML = `<div class="tel-tip-time">${timeStr}</div>${rows}<div class="tel-tip-total">$${total.toFixed(4)}</div>`;
    tooltip.hidden = false;
    tooltip.style.left = Math.min(e.clientX + 14, window.innerWidth - 180) + 'px';
    tooltip.style.top  = (e.clientY - 60) + 'px';
  };
  canvas.onmouseleave = () => { if (tooltip) tooltip.hidden = true; };

  // Scroll to most recent (right)
  requestAnimationFrame(() => { if (wrap) wrap.scrollLeft = wrap.scrollWidth; });
}

function renderTelemetryModal(data) {
  const { summary } = data;
  if (!summary) return;

  document.getElementById('tel-total-calls').textContent = summary.totalCalls ?? 0;
  document.getElementById('tel-total-in').textContent    = fmtTokens(summary.totalInputTokens  ?? 0);
  document.getElementById('tel-total-out').textContent   = fmtTokens(summary.totalOutputTokens ?? 0);
  document.getElementById('tel-total-cost').textContent  = '$' + (summary.totalCost ?? 0).toFixed(4);

  // By-model pie
  const byModel = Object.entries(summary.byModel ?? {}).map(([k, v]) => ({ label: k, value: v.cost }));
  drawPie(document.getElementById('tel-chart-model'), byModel);
  renderLegend('tel-legend-model', byModel, summary.totalCost);

  // By-agent pie
  const byAgent = Object.entries(summary.byAgent ?? {}).map(([k, v]) => ({ label: k, value: v.cost }));
  drawPie(document.getElementById('tel-chart-agent'), byAgent);
  renderLegend('tel-legend-agent', byAgent, summary.totalCost);

  // Hourly bar chart
  renderHourlyChart(data.records ?? []);

  // Table by model
  const tbody = document.getElementById('tel-table-body');
  tbody.innerHTML = '';
  for (const [model, m] of Object.entries(summary.byModel ?? {})) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(model)}</td>
      <td>${m.calls}</td>
      <td>${fmtTokens(m.inputTokens)}</td>
      <td>${fmtTokens(m.outputTokens)}</td>
      <td>$${m.cost.toFixed(4)}</td>
    `;
    tbody.appendChild(tr);
  }
}

function renderLegend(elId, data, total) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = data.map((d, i) => {
    const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) + '%' : '—';
    return `<div class="tel-legend-item">
      <span class="tel-legend-dot" style="background:${PIE_COLORS[i % PIE_COLORS.length]}"></span>
      <span class="tel-legend-label">${esc(d.label)}</span>
      <span class="tel-legend-pct">${pct}</span>
    </div>`;
  }).join('');
}

// ── Files panel ──────────────────────────────────────────────────────────────

function fmtSize(bytes) {
  if (bytes === 0) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function fileIcon(name, isDir) {
  if (isDir) return '';
  const ext = name.split('.').pop()?.toLowerCase();
  const icons = { pdf: '📄', docx: '📝', doc: '📝', xlsx: '📊', xls: '📊', md: '📋',
                  txt: '📋', png: '🖼', jpg: '🖼', jpeg: '🖼', gif: '🖼', mp4: '🎬',
                  mp3: '🎵', zip: '📦', csv: '📊', json: '⚙️', ts: '⚙️', js: '⚙️' };
  return icons[ext] || '📄';
}

const VIEWABLE_EXTS = new Set(['txt', 'md', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);

function fileExt(name) {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

function buildFileTree(files) {
  const nodeMap = new Map();
  const roots   = [];
  for (const f of files) nodeMap.set(f.relativePath, { ...f, children: [] });
  for (const f of files) {
    const node   = nodeMap.get(f.relativePath);
    const parts  = f.relativePath.split('/');
    parts.pop();
    const parent = nodeMap.get(parts.join('/'));
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function renderFileNode(node) {
  if (node.isDir) {
    const inner = node.children.map(renderFileNode).join('') || '<div class="files-list-empty">Empty</div>';
    return `<details class="file-tree-dir" open>
      <summary class="file-row file-row--dir">
        <span class="file-icon">${fileIcon(node.name, true)}</span>
        <span class="file-name" title="${esc(node.relativePath)}">${esc(node.name)}</span>
      </summary>
      ${inner}
    </details>`;
  }
  return `<div class="file-row">
    <span class="file-icon">${fileIcon(node.name, false)}</span>
    <span class="file-name" title="${esc(node.relativePath)}">${esc(node.name)}</span>
    <span class="file-size">${fmtSize(node.size)}</span>
    ${buildFileActions(node)}
  </div>`;
}

function renderFilesSection(elId, files) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!files || files.length === 0) {
    el.innerHTML = `<div class="files-list-empty">No files yet</div>`;
    return;
  }
  el.innerHTML = buildFileTree(files).map(renderFileNode).join('');
}

function buildFileActions(f) {
  const url = `/api/project/file?path=${encodeURIComponent(f.relativePath)}`;
  const canView = VIEWABLE_EXTS.has(fileExt(f.name));
  const viewBtn = canView
    ? `<button class="file-action-btn file-view-btn" title="View" data-name="${esc(f.name)}" data-path="${esc(f.relativePath)}"><img src="/assets/preview.svg" class="svg-icon" alt="Preview"></button>`
    : `<span class="file-action-placeholder"></span>`;
  const dlBtn = `<a class="file-action-btn" title="Download" href="${esc(url)}" download="${esc(f.name)}"><img src="/assets/download.svg" class="svg-icon" alt="Download"></a>`;
  return `<span class="file-actions">${viewBtn}${dlBtn}</span>`;
}

function initFileViewer() {
  // Delegated listener — handles view buttons in both sources and outputs lists
  document.addEventListener('click', e => {
    const btn = e.target.closest('.file-view-btn');
    if (!btn) return;
    openFileViewer(btn.dataset.name, btn.dataset.path);
  });

  // Double-click a file row: view if available, otherwise trigger download
  document.addEventListener('dblclick', e => {
    const row = e.target.closest('.file-row:not(.file-row--dir)');
    if (!row) return;
    const viewBtn = row.querySelector('.file-view-btn');
    if (viewBtn) {
      openFileViewer(viewBtn.dataset.name, viewBtn.dataset.path);
    } else {
      const dlLink = row.querySelector('a.file-action-btn[download]');
      if (dlLink) dlLink.click();
    }
  });

  document.getElementById('file-viewer-close').addEventListener('click', () => {
    document.getElementById('file-viewer-modal').hidden = true;
  });
  document.getElementById('file-viewer-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) document.getElementById('file-viewer-modal').hidden = true;
  });
}

function initGenBgModal() {
  const modal       = document.getElementById('gen-bg-modal');
  const closeBtn    = document.getElementById('gen-bg-close');
  const cancelBtn   = document.getElementById('gen-bg-cancel');
  const submitBtn   = document.getElementById('gen-bg-submit');
  const spinner     = document.getElementById('gen-bg-spinner');
  const preview     = document.getElementById('gen-bg-preview');
  const errorEl     = document.getElementById('gen-bg-error');
  const nameInput   = document.getElementById('gen-bg-name');
  const promptInput = document.getElementById('gen-bg-prompt');

  const close = () => {
    modal.hidden = true;
    nameInput.value = '';
    promptInput.value = '';
    preview.hidden = true;
    errorEl.textContent = '';
  };
  closeBtn.addEventListener('click', close);
  cancelBtn.addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });

  for (const el of [nameInput, promptInput]) {
    el.addEventListener('keydown', e => { if (e.key === 'Enter') submitBtn.click(); });
  }

  submitBtn.addEventListener('click', async () => {
    const name   = nameInput.value.trim();
    const prompt = promptInput.value.trim();
    if (!name)   { errorEl.textContent = 'Please enter a name for the background.'; return; }
    if (!prompt) { errorEl.textContent = 'Please enter a scene description.'; return; }
    errorEl.textContent = '';
    submitBtn.disabled = true;
    preview.hidden = true;
    spinner.hidden = false;

    try {
      const res  = await fetch('/api/images/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, prompt }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { errorEl.textContent = data.error ?? 'Generation failed'; return; }

      // Show preview
      const img = document.getElementById('gen-bg-img');
      img.src = `/backgrounds/${encodeURIComponent(data.filename)}`;
      preview.hidden = false;

      // Refresh background list and select the new file in the library modal
      await getBackgrounds(true);
      populateBackgroundSelect(data.filename, 'add-agent-background');
      close();
    } catch (err) {
      errorEl.textContent = err.message || 'Generation failed';
    } finally {
      spinner.hidden = true;
      submitBtn.disabled = false;
    }
  });
}

async function populateBackgroundSelect(selectedFile, selId = 'add-agent-background') {
  const sel = document.getElementById(selId);
  if (!sel) return;
  const backgrounds = await getBackgrounds();
  sel.innerHTML = '<option value="">(no background)</option>';
  for (const f of backgrounds) {
    const opt = document.createElement('option');
    opt.value = f;
    opt.textContent = f.replace(/\.[^.]+$/, '');
    sel.appendChild(opt);
  }
  if (selectedFile) sel.value = selectedFile;
}

function openFileViewer(name, relativePath) {
  const url = `/api/project/file?path=${encodeURIComponent(relativePath)}`;
  const ext = fileExt(name);
  const modal = document.getElementById('file-viewer-modal');
  const body  = document.getElementById('file-viewer-body');
  const dl    = document.getElementById('file-viewer-download');

  document.getElementById('file-viewer-name').textContent = name;
  dl.href     = url;
  dl.download = name;
  body.innerHTML = '';

  const imgExts = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
  if (ext === 'pdf') {
    body.innerHTML = `<iframe src="${esc(url)}" class="file-viewer-iframe"></iframe>`;
  } else if (imgExts.has(ext)) {
    body.innerHTML = `<div class="file-viewer-img-wrap"><img src="${esc(url)}" class="file-viewer-img" alt="${esc(name)}"></div>`;
  } else {
    // txt or md — fetch and render
    body.innerHTML = `<div class="file-viewer-loading">Loading…</div>`;
    fetch(url)
      .then(r => r.text())
      .then(text => {
        if (ext === 'md') {
          const html = window.marked ? window.marked.parse(text) : `<pre>${esc(text)}</pre>`;
          body.innerHTML = `<div class="file-viewer-md">${html}</div>`;
        } else {
          body.innerHTML = `<pre class="file-viewer-pre">${esc(text)}</pre>`;
        }
      })
      .catch(() => { body.innerHTML = `<div class="file-viewer-loading">Failed to load file.</div>`; });
  }

  modal.hidden = false;
}


function renderFilesList(sources, outputs, tickets) {
  renderFilesSection('files-sources-list', sources);
  renderFilesSection('files-outputs-list', outputs);

  const section = document.getElementById('files-tickets-section');
  const list    = document.getElementById('files-tickets-list');
  if (!section || !list) return;

  if (!tickets || tickets.length === 0) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  list.innerHTML = tickets.map(t => {
    const inner = buildFileTree(t.files).map(renderFileNode).join('') || '<div class="files-list-empty">Empty</div>';
    return `<details class="files-ticket-group" open>
      <summary class="files-ticket-header">${esc(t.id)}</summary>
      ${inner}
    </details>`;
  }).join('');
}

function fetchFiles() {
  fetch('/api/project/files')
    .then(r => r.json())
    .then(data => renderFilesList(data.sources, data.outputs, data.tickets))
    .catch(() => {});
}

function startFilesRefresh() {
  if (filesRefreshTimer) clearInterval(filesRefreshTimer);
  filesRefreshTimer = setInterval(fetchFiles, 30_000);
}

function initFileUpload() {
  document.getElementById('files-open-folder-btn')?.addEventListener('click', () => {
    fetch('/api/project/open-folder', { method: 'POST' }).catch(() => {});
  });

  document.getElementById('files-clear-btn')?.addEventListener('click', async () => {
    if (!confirm('Clear all project files, tickets, and agent history? Agent definitions will be kept. This cannot be undone.')) return;
    const btn = document.getElementById('files-clear-btn');
    btn.disabled = true;
    btn.textContent = 'Clearing…';
    try {
      const r = await fetch('/api/project/clear', { method: 'POST' });
      if (!r.ok) { const d = await r.json(); alert('Clear failed: ' + (d.error ?? r.status)); }
      else fetchFiles();
    } catch (err) {
      alert('Clear failed: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Clear project';
    }
  });

  const input = document.getElementById('files-upload-input');
  if (!input) return;
  input.addEventListener('change', async () => {
    const files = [...input.files];
    input.value = '';
    for (const file of files) {
      try {
        await fetch('/api/project/upload', {
          method: 'POST',
          headers: { 'X-Filename': encodeURIComponent(file.name) },
          body: file,
        });
      } catch { /* ignore */ }
    }
    fetchFiles();
  });
}

function initTelemetry() {
  const btn   = document.getElementById('telemetry-btn');
  const modal = document.getElementById('telemetry-modal');
  const close = document.getElementById('telemetry-close');

  btn.addEventListener('click', async () => {
    modal.hidden = false;
    try {
      const data = await fetch('/api/telemetry').then(r => r.json());
      renderTelemetryModal(data);
    } catch { /* silently ignore */ }
  });

  close.addEventListener('click', () => { modal.hidden = true; });
  modal.addEventListener('click', e => { if (e.target === modal) modal.hidden = true; });
}

// ── Agent Library tab ─────────────────────────────────────────────────────────

async function fetchGlobalAgents() {
  try {
    const [globalAgents, projectAgents] = await Promise.all([
      fetch('/api/global-agents').then(r => r.json()),
      fetch('/api/agents').then(r => r.json()),
    ]);
    renderGlobalAgents(globalAgents, new Set(projectAgents.map(a => a.id ?? a.name)));
  } catch { /* ignore */ }
}

function renderGlobalAgents(agents, projectIds) {
  const list = document.getElementById('library-agent-list');
  if (!list) return;
  if (!agents.length) {
    list.innerHTML = '<div style="padding:16px 12px;color:var(--text-muted);font-size:13px">No agents in the library yet. Create one with the button above.</div>';
    return;
  }
  const byName = (a, b) => (a.identity?.name ?? '').localeCompare(b.identity?.name ?? '');
  const inProj  = agents.filter(a => projectIds.has(a.id)).sort(byName);
  const notProj = agents.filter(a => !projectIds.has(a.id)).sort(byName);
  const sorted  = [...inProj, ...notProj];
  list.innerHTML = sorted.map(agent => {
    const hats    = (agent.hatType ?? []).filter(h => h !== 'none').map(h => h.charAt(0).toUpperCase() + h.slice(1)).join('+') || 'No Hat';
    const active  = projectIds.has(agent.id);
    return `
      <div class="library-agent-row${active ? ' library-agent-row--active' : ''}" data-agent-id="${agent.id}" style="cursor:pointer" title="Click to edit">
        <div class="library-agent-body" style="flex:1;min-width:0">
          <div class="library-agent-name">${escHtml(agent.identity?.name ?? 'Unnamed')}</div>
          <div class="library-agent-meta">${escHtml(hats)} · ${escHtml(agent.model ?? '')}</div>
        </div>
        ${active ? '<span class="library-agent-in-project">In project</span>' : ''}
        <div class="library-agent-actions">
          ${active ? '' : `<button class="library-btn library-btn--add" data-action="add" data-agent-id="${agent.id}">+ Add to project</button>`}
          <button class="library-btn library-btn--del" data-action="delete" data-agent-id="${agent.id}" title="Remove from library">✕</button>
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('[data-action="add"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const agentId = btn.dataset.agentId;
      try {
        const r = await fetch('/api/project/add-agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId }) });
        if (!r.ok) { const e = await r.json(); alert(e.error ?? 'Failed to add agent'); return; }
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

  list.querySelectorAll('[data-action="add"]').forEach(btn => {
    btn.addEventListener('click', (e) => e.stopPropagation());
  });

  list.querySelectorAll('.library-agent-row').forEach(row => {
    row.addEventListener('click', () => {
      const agentId = row.dataset.agentId;
      const agent   = agents.find(a => a.id === agentId);
      if (agent) openLibraryEdit(agent);
    });
  });
}


function initLibraryTab() {
  document.getElementById('library-new-agent-btn')?.addEventListener('click', () => {
    openAddAgent();
  });
}


// ── Scheduled Actions tab ─────────────────────────────────────────────────────

async function fetchScheduledActions() {
  try {
    const actions = await fetch('/api/scheduled-actions').then(r => r.json());
    renderScheduledActions(actions);
  } catch { /* ignore */ }
}

function buildScheduleRow(action) {
  const intervalMins = action.intervalSeconds ? Math.round(action.intervalSeconds / 60) : null;
  const intervalText = intervalMins ? `Every ${intervalMins} min` : 'Once';

  const row = document.createElement('div');
  row.className = 'schedules-row';
  row.dataset.actionId = action.id;

  const isMcp = action.type === 'mcp_tool_call';
  const descText = isMcp && action.mcpToolCall
    ? `${action.mcpToolCall.serverName}${action.mcpToolCall.personalMcpAgentName ? ` (${action.mcpToolCall.personalMcpAgentName})` : ''}: ${action.mcpToolCall.toolName.replace(/^mcp__[^_]+__/, '')} → ${action.mcpToolCall.condition || 'always notify'}`
    : action.description;

  const viewBody = document.createElement('div');
  viewBody.className = 'schedules-row-body';
  viewBody.title = 'Click to edit';
  viewBody.innerHTML = `
    <div class="schedules-row-label">${escHtml(action.label)}${isMcp ? ' <span class="schedules-mcp-badge">MCP</span>' : ''}</div>
    <div class="schedules-row-desc">${escHtml(descText)}</div>`;

  const intervalBadge = document.createElement('span');
  intervalBadge.className = 'schedules-row-interval';
  intervalBadge.textContent = intervalText;

  const delBtn = document.createElement('button');
  delBtn.className = 'library-btn library-btn--del';
  delBtn.title = 'Delete';
  delBtn.textContent = '✕';

  const rowActions = document.createElement('div');
  rowActions.className = 'schedules-row-actions';
  rowActions.appendChild(delBtn);

  row.appendChild(viewBody);
  row.appendChild(intervalBadge);
  row.appendChild(rowActions);

  viewBody.addEventListener('click', () => openScheduleModal(action));

  delBtn.addEventListener('click', async () => {
    if (!confirm('Delete this scheduled action?')) return;
    try {
      await fetch(`/api/scheduled-actions/${encodeURIComponent(action.id)}`, { method: 'DELETE' });
      fetchScheduledActions();
    } catch { alert('Network error'); }
  });

  return row;
}

function renderScheduledActions(actions) {
  const list = document.getElementById('schedules-list');
  if (!list) return;
  list.innerHTML = '';
  if (!actions.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:16px 12px;color:var(--text-muted);font-size:13px';
    empty.textContent = 'No global scheduled actions yet. Add one below.';
    list.appendChild(empty);
    return;
  }
  for (const action of actions) list.appendChild(buildScheduleRow(action));
}

// ── MCP tool schema cache ─────────────────────────────────────────────────────
let _mcpToolSchemas = null;

async function loadMcpToolSchemas() {
  if (_mcpToolSchemas) return _mcpToolSchemas;
  _mcpToolSchemas = await fetch('/api/mcp/tools').then(r => r.json()).catch(() => []);
  return _mcpToolSchemas;
}

async function populateMcpServerSelect(sel) {
  sel.innerHTML = '<option value="">Loading…</option>';
  const schemas = await loadMcpToolSchemas();
  sel.innerHTML = '<option value="">Select a server…</option>';
  for (const entry of schemas) {
    const opt = document.createElement('option');
    // encode agent name in the value as "server||agentName" (|| not valid in server names)
    opt.value = entry.agentName ? `${entry.server}||${entry.agentName}` : entry.server;
    opt.textContent = entry.agentName ? `${entry.server} (${entry.agentName})` : entry.server;
    sel.appendChild(opt);
  }
}

/** Parse the compound server-select value → { server, agentName } */
function parseMcpServerValue(val) {
  const idx = val.indexOf('||');
  if (idx === -1) return { server: val, agentName: null };
  return { server: val.slice(0, idx), agentName: val.slice(idx + 2) };
}

function populateMcpToolSelect(toolSel, serverSelectValue) {
  toolSel.innerHTML = '';
  toolSel.disabled = !serverSelectValue;
  if (!serverSelectValue || !_mcpToolSchemas) { toolSel.innerHTML = '<option value="">Select server first</option>'; return; }
  const { server, agentName } = parseMcpServerValue(serverSelectValue);
  const entry = _mcpToolSchemas.find(s => s.server === server && (s.agentName ?? null) === agentName);
  toolSel.innerHTML = '<option value="">Select a tool…</option>';
  if (!entry) return;
  for (const tool of entry.tools) {
    const opt = document.createElement('option');
    opt.value = tool.name;
    opt.textContent = tool.name.replace(`mcp__${server}__`, '');
    toolSel.appendChild(opt);
  }
}

function buildMcpParamFields(container, toolName) {
  container.innerHTML = '';
  if (!toolName || !_mcpToolSchemas) return;
  const serverSelectValue = document.getElementById('schedules-mcp-server')?.value ?? '';
  const { server: serverName, agentName } = parseMcpServerValue(serverSelectValue);
  const serverEntry = _mcpToolSchemas.find(s => s.server === serverName && (s.agentName ?? null) === agentName);
  const tool = serverEntry?.tools.find(t => t.name === toolName);
  if (!tool) return;
  const props = tool.parameters?.properties ?? {};
  const required = new Set(tool.parameters?.required ?? []);
  const keys = Object.keys(props);
  if (!keys.length) {
    const note = document.createElement('div');
    note.className = 'schedules-mcp-hint';
    note.style.padding = '4px 0';
    note.textContent = 'This tool takes no parameters.';
    container.appendChild(note);
    return;
  }
  for (const key of keys) {
    const schema = props[key];
    const row = document.createElement('div');
    row.className = 'schedules-mcp-param-row';
    const lbl = document.createElement('label');
    lbl.className = 'schedules-mcp-label';
    lbl.textContent = key + (required.has(key) ? ' *' : '');
    if (schema.description) {
      const hint = document.createElement('span');
      hint.className = 'schedules-mcp-hint';
      hint.textContent = ' — ' + schema.description;
      lbl.appendChild(hint);
    }
    let inp;
    if (schema.enum) {
      inp = document.createElement('select');
      inp.className = 'schedules-input';
      if (!required.has(key)) {
        const empty = document.createElement('option');
        empty.value = ''; empty.textContent = '— none —';
        inp.appendChild(empty);
      }
      for (const v of schema.enum) {
        const opt = document.createElement('option');
        opt.value = v; opt.textContent = v;
        inp.appendChild(opt);
      }
    } else {
      inp = document.createElement('input');
      inp.type = (schema.type === 'number' || schema.type === 'integer') ? 'number' : 'text';
      inp.className = 'schedules-input';
      inp.placeholder = schema.description ?? key;
      inp.autocomplete = 'off';
    }
    inp.dataset.paramKey = key;
    inp.dataset.paramType = schema.type ?? 'string';
    row.appendChild(lbl);
    row.appendChild(inp);
    container.appendChild(row);
  }
}

function collectMcpArgs(container) {
  const args = {};
  for (const inp of container.querySelectorAll('[data-param-key]')) {
    const val = inp.value;
    if (val === '') continue;
    const type = inp.dataset.paramType;
    const coerced = (type === 'number' || type === 'integer') ? Number(val) : type === 'boolean' ? val === 'true' : val;
    if (coerced === false || (typeof coerced === 'number' && isNaN(coerced))) continue;
    args[inp.dataset.paramKey] = coerced;
  }
  return args;
}

function closeScheduleModal() {
  document.getElementById('schedule-modal').hidden = true;
}

async function openScheduleModal(action) {
  const modal   = document.getElementById('schedule-modal');
  const titleEl = document.getElementById('schedule-modal-title');
  const saveBtn = document.getElementById('schedules-add-btn');

  // Reset all fields
  document.getElementById('schedules-add-label').value       = '';
  document.getElementById('schedules-add-description').value = '';
  document.getElementById('schedules-add-interval').value    = '';
  document.getElementById('schedules-mcp-condition').value   = '';
  document.getElementById('schedules-mcp-message').value     = '';
  document.getElementById('schedules-mcp-params').innerHTML  = '';
  document.getElementById('schedules-mcp-test-result').hidden = true;
  document.querySelector('input[name="schedules-type"][value="prompt"]').checked = true;
  document.getElementById('schedules-prompt-fields').hidden = false;
  document.getElementById('schedules-mcp-fields').hidden    = true;
  const serverSel = document.getElementById('schedules-mcp-server');
  const toolSel   = document.getElementById('schedules-mcp-tool');
  serverSel.innerHTML = '<option value="">Select a server…</option>';
  toolSel.innerHTML   = '<option value="">Select server first</option>';
  toolSel.disabled    = true;

  if (action) {
    titleEl.textContent  = 'Edit Scheduled Action';
    saveBtn.textContent  = 'Save';
    modal.dataset.editId = action.id;
    document.getElementById('schedules-add-label').value = action.label;
    const intervalMins = action.intervalSeconds ? Math.round(action.intervalSeconds / 60) : '';
    document.getElementById('schedules-add-interval').value = String(intervalMins);

    if (action.type === 'mcp_tool_call' && action.mcpToolCall) {
      document.querySelector('input[name="schedules-type"][value="mcp_tool_call"]').checked = true;
      document.getElementById('schedules-prompt-fields').hidden = true;
      document.getElementById('schedules-mcp-fields').hidden    = false;
      document.getElementById('schedules-mcp-condition').value  = action.mcpToolCall.condition ?? '';
      document.getElementById('schedules-mcp-message').value    = action.mcpToolCall.messageTemplate ?? '';

      // Populate server/tool/params asynchronously
      _mcpToolSchemas = null;
      await populateMcpServerSelect(serverSel);
      const mcp = action.mcpToolCall;
      const targetVal = mcp.personalMcpAgentName
        ? `${mcp.serverName}||${mcp.personalMcpAgentName}`
        : mcp.serverName;
      serverSel.value = targetVal;
      populateMcpToolSelect(toolSel, serverSel.value);
      toolSel.value = mcp.toolName;
      buildMcpParamFields(document.getElementById('schedules-mcp-params'), mcp.toolName);
      for (const [key, val] of Object.entries(mcp.args ?? {})) {
        const inp = document.querySelector(`#schedules-mcp-params [data-param-key="${key}"]`);
        if (inp) inp.value = val;
      }
    } else {
      document.getElementById('schedules-add-description').value = action.description ?? '';
    }
  } else {
    titleEl.textContent  = 'New Scheduled Action';
    saveBtn.textContent  = 'Add';
    modal.dataset.editId = '';
  }

  modal.hidden = false;
}

function initSchedulesTab() {
  document.getElementById('schedules-new-btn')?.addEventListener('click', () => openScheduleModal(null));
  document.getElementById('schedule-modal-close')?.addEventListener('click', closeScheduleModal);
  document.getElementById('schedule-modal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('schedule-modal')) closeScheduleModal();
  });

  // Type switching
  document.querySelectorAll('input[name="schedules-type"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const isMcp = document.querySelector('input[name="schedules-type"]:checked')?.value === 'mcp_tool_call';
      document.getElementById('schedules-prompt-fields').hidden = isMcp;
      document.getElementById('schedules-mcp-fields').hidden    = !isMcp;
      if (isMcp) {
        _mcpToolSchemas = null;
        populateMcpServerSelect(document.getElementById('schedules-mcp-server'));
      }
    });
  });

  // Server → tool cascade
  document.getElementById('schedules-mcp-server')?.addEventListener('change', () => {
    const serverSelectValue = document.getElementById('schedules-mcp-server').value;
    populateMcpToolSelect(document.getElementById('schedules-mcp-tool'), serverSelectValue);
    document.getElementById('schedules-mcp-params').innerHTML = '';
  });

  // Tool → param fields
  document.getElementById('schedules-mcp-tool')?.addEventListener('change', () => {
    buildMcpParamFields(document.getElementById('schedules-mcp-params'), document.getElementById('schedules-mcp-tool').value);
    document.getElementById('schedules-mcp-test-result').hidden = true;
  });

  // Test button
  document.getElementById('schedules-mcp-test-btn')?.addEventListener('click', async () => {
    const serverSelectValue = document.getElementById('schedules-mcp-server')?.value ?? '';
    const toolName          = document.getElementById('schedules-mcp-tool')?.value ?? '';
    const resultEl          = document.getElementById('schedules-mcp-test-result');
    if (!serverSelectValue || !toolName) { alert('Please select a server and tool first'); return; }
    const { server: serverName, agentName } = parseMcpServerValue(serverSelectValue);
    const args = collectMcpArgs(document.getElementById('schedules-mcp-params'));
    resultEl.hidden = false;
    resultEl.textContent = 'Running…';
    resultEl.className = 'schedules-mcp-test-result schedules-mcp-test-result--pending';
    try {
      const r = await fetch('/api/mcp/test-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverName, toolName, args, agentName: agentName || undefined }),
      });
      const data = await r.json();
      if (r.ok) {
        // Pretty-print raw MCP result object
        let display = data.result != null ? JSON.stringify(data.result, null, 2) : '(empty result)';

        // Derive the text `result` string the same way the server does (joined text blocks)
        const blocks = Array.isArray(data.result?.content) ? data.result.content : [];
        const resultStr = blocks.filter(b => b.type === 'text').map(b => b.text ?? '').join('\n')
          || JSON.stringify(data.result?.content ?? '');

        // Evaluate condition if filled in
        const condVal = document.getElementById('schedules-mcp-condition')?.value?.trim() ?? '';
        if (condVal) {
          let condLine;
          try {
            // eslint-disable-next-line no-new-func
            const passes = !!(new Function('result', `return !!(${condVal})`))(resultStr);
            condLine = `\n\n─ Condition: "${condVal}"\n  result string: ${JSON.stringify(resultStr.slice(0, 120))}${resultStr.length > 120 ? '…' : ''}\n  → ${passes ? '✓ TRUE — agent would be notified' : '✗ FALSE — agent would NOT be notified'}`;
          } catch (e) {
            condLine = `\n\n─ Condition: "${condVal}"\n  → Invalid JS: ${e.message}`;
          }
          display += condLine;
        }

        resultEl.textContent = display;
        resultEl.className = 'schedules-mcp-test-result schedules-mcp-test-result--ok';
      } else {
        resultEl.textContent = `Error: ${data.error ?? 'Unknown error'}`;
        resultEl.className = 'schedules-mcp-test-result schedules-mcp-test-result--error';
      }
    } catch (err) {
      resultEl.textContent = `Network error: ${err.message}`;
      resultEl.className = 'schedules-mcp-test-result schedules-mcp-test-result--error';
    }
  });

  // Save (create or update)
  document.getElementById('schedules-add-btn')?.addEventListener('click', async () => {
    const modal    = document.getElementById('schedule-modal');
    const editId   = modal.dataset.editId ?? '';
    const type     = document.querySelector('input[name="schedules-type"]:checked')?.value ?? 'prompt';
    const label    = document.getElementById('schedules-add-label').value.trim();
    const intervalRaw     = document.getElementById('schedules-add-interval').value;
    const intervalMinutes = intervalRaw ? parseInt(intervalRaw, 10) : null;
    if (!label) { alert('Label is required'); return; }

    let body;
    if (type === 'mcp_tool_call') {
      const serverSelectValue = document.getElementById('schedules-mcp-server').value;
      const toolName          = document.getElementById('schedules-mcp-tool').value;
      const condition         = document.getElementById('schedules-mcp-condition').value.trim();
      const messageTemplate   = document.getElementById('schedules-mcp-message').value.trim();
      if (!serverSelectValue || !toolName) { alert('Please select a server and tool'); return; }
      if (!messageTemplate) { alert('Message template is required'); return; }
      const { server: serverName, agentName } = parseMcpServerValue(serverSelectValue);
      const args = collectMcpArgs(document.getElementById('schedules-mcp-params'));
      const mcpToolCall = { serverName, toolName, args, condition, messageTemplate };
      if (agentName) mcpToolCall.personalMcpAgentName = agentName;
      body = { label, type: 'mcp_tool_call', mcpToolCall, intervalMinutes };
    } else {
      const description = document.getElementById('schedules-add-description').value.trim();
      if (!description) { alert('Description is required'); return; }
      body = { label, description, intervalMinutes };
    }

    const saveBtn = document.getElementById('schedules-add-btn');
    saveBtn.disabled = true; saveBtn.textContent = '…';
    try {
      const url    = editId ? `/api/scheduled-actions/${encodeURIComponent(editId)}` : '/api/scheduled-actions';
      const method = editId ? 'PATCH' : 'POST';
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) { const e = await r.json(); alert(e.error ?? 'Failed'); saveBtn.disabled = false; saveBtn.textContent = editId ? 'Save' : 'Add'; return; }
      closeScheduleModal();
      fetchScheduledActions();
    } catch { alert('Network error'); saveBtn.disabled = false; saveBtn.textContent = editId ? 'Save' : 'Add'; }
  });
}
