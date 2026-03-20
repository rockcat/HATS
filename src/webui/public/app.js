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

let state = { agents: [], tasks: [] };

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

function renderKanban(tasks) {
  const active  = tasks.filter(t => t.status === 'active' || t.status === 'blocked');
  const backlog = tasks.filter(t => t.status === 'pending');
  const done    = tasks.filter(t => t.status === 'complete');

  const activeEl  = document.getElementById('active-tasks');
  const backlogEl = document.getElementById('backlog-tasks');

  activeEl.innerHTML  = active.length  ? active.map(taskHTML).join('')              : '<p class="empty-hint">No active tasks</p>';
  backlogEl.innerHTML = backlog.length || done.length ? [...backlog, ...done].map(taskHTML).join('') : '<p class="empty-hint">Backlog is empty</p>';
}

function taskHTML(task) {
  const agent = state.agents.find(a => a.name === task.assignedTo);
  const c = hat(agent ? agent.hatType : 'white');
  return `
    <div class="task-card">
      <div class="task-body">
        <div class="task-status-dot ${task.status}"></div>
        <div class="task-description">${esc(task.description)}</div>
      </div>
      <div class="task-footer">
        <span class="task-assignee">
          <span class="hat-pip" style="background:${c.bar}"></span>
          ${esc(task.assignedTo)}
        </span>
        <span class="task-badge ${task.status}">${task.status}</span>
      </div>
    </div>`;
}

function esc(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// ── State application ─────────────────────────────────────────────────────────

function applyState(newState) {
  state = newState;
  renderAgents(state.agents);
  renderKanban(state.tasks);
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
    if (msg.type === 'init' || msg.type === 'full_update') {
      applyState({ agents: msg.agents, tasks: msg.tasks });
    } else if (msg.type === 'agent_update') {
      state.agents = msg.agents;
      renderAgents(state.agents);
    } else if (msg.type === 'task_update') {
      state.tasks = msg.tasks;
      renderKanban(state.tasks);
    }
  };
}

connect();
