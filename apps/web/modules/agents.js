// ── Agent card rendering ──────────────────────────────────────────────────────

import { hat, hatLabel } from './hat.js';
import { STATE_LABEL } from './constants.js';
import { esc } from './utils.js';

export function renderAgents(agents) {
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

  updateCommsOverlay(agents, container);
}

export function createCard(agent) {
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

export function updateCard(el, agent) {
  applyCardData(el, agent);
}

export function applyCardData(el, agent) {
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

  const metaEl = el.querySelector('.agent-meta');
  if (metaEl) {
    const parts = [];
    if (agent.specialisation) parts.push(agent.specialisation);
    if (agent.model)          parts.push(agent.model);
    metaEl.textContent = parts.join(' · ');
    metaEl.hidden = parts.length === 0;
  }

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

export function reorderCards(container, agents) {
  const ordered = buildOrder(agents);

  const first = new Map(
    [...container.querySelectorAll('.agent-card')]
      .map(el => [el.dataset.name, el.getBoundingClientRect()])
  );

  for (const name of ordered) {
    const el = container.querySelector(`.agent-card[data-name="${CSS.escape(name)}"]`);
    if (el) container.insertBefore(el, container.querySelector('#comms-overlay'));
  }

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
export function buildOrder(agents) {
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

export function updateCommsOverlay(agents, container) {
  const svg = document.getElementById('comms-overlay');
  svg.innerHTML = '';

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

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1); line.setAttribute('y1', y1);
    line.setAttribute('x2', x2); line.setAttribute('y2', y2);
    line.setAttribute('stroke', '#8957e5');
    line.setAttribute('stroke-width', '5');
    line.setAttribute('stroke-dasharray', '5 4');
    line.setAttribute('opacity', '0.45');
    svg.appendChild(line);

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
