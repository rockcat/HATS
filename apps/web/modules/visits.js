// ── Visits ────────────────────────────────────────────────────────────────────
//
// Agents visiting other teams to do a piece of their own team's work, and
// agents from other teams visiting this one. Admins decide on requests,
// recall their own agents and send visitors home. See docs/team-visits.md in
// the HATS repository.

import { state } from './state.js';

let projectId = null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

async function currentProject() {
  if (projectId) return projectId;
  projectId = await fetch('/api/project').then((r) => r.json()).then((p) => p.id).catch(() => null);
  return projectId;
}

/** Group a team's visits by what can be done about them from here. */
export function groupVisits(visits, project) {
  const here = (v) => same(v.host, project);
  return {
    asking: visits.filter((v) => here(v) && v.state === 'requested'),
    visiting: visits.filter((v) => here(v) && v.state === 'visiting'),
    away: visits.filter((v) => !here(v) && v.state === 'visiting'),
    waiting: visits.filter((v) => !here(v) && (v.state === 'requested' || v.state === 'approved')),
  };
}

const GROUPS = [
  ['asking', 'Asking to visit here', [['approve', 'Approve'], ['refuse', 'Refuse']]],
  ['visiting', 'Visiting here', [['end', 'Send home']]],
  ['away', 'Ours, visiting other teams', [['recall', 'Recall']]],
  ['waiting', 'Ours, waiting to go', [['recall', 'Call off']]],
];

function card(visit, actions, project) {
  const item = document.createElement('div');
  item.className = 'visit-item';
  const ours = !same(visit.host, project);
  const where = ours ? `to ${esc(visit.host)}` : `from ${esc(visit.home)}`;
  const ends = visit.endsBy ? ` · ends ${new Date(visit.endsBy).toLocaleString([], { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}` : '';
  item.innerHTML = `
    <div class="visit-head"><strong>${esc(visit.agent.name)}</strong> ${where}
      <span class="visit-meta">for ${esc(visit.reason.ticket)}${ends}${visit.recall ? ' · recalled' : ''}</span></div>
    <div class="visit-reason">${esc(visit.reason.purpose)}</div>
    <div class="visit-expect">Brings back: ${esc(visit.reason.expectedResult)}</div>
    <div class="visit-actions"></div>
    <div class="visit-error" hidden></div>`;
  const bar = item.querySelector('.visit-actions');
  for (const [step, label] of actions) {
    const button = document.createElement('button');
    button.className = 'visit-btn';
    button.textContent = label;
    button.addEventListener('click', () => void act(visit, step, item));
    bar.appendChild(button);
  }
  return item;
}

async function act(visit, step, item) {
  const note = step === 'approve' ? '' : (prompt('A note to go with it (optional):') ?? null);
  if (note === null) return;
  const res = await fetch(`/api/visits/${encodeURIComponent(visit.id)}/${step}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note }),
  }).catch(() => null);
  if (!res || !res.ok) {
    const body = res ? await res.json().catch(() => ({})) : {};
    const error = item.querySelector('.visit-error');
    error.textContent = body.error ?? 'The runner is not answering.';
    error.hidden = false;
    return;
  }
  void fetchVisits();
}

/** Fetch this team's visits and show them, with a badge for requests waiting here. */
export async function fetchVisits() {
  const pane = document.getElementById('visits-content');
  if (!pane) return;
  const res = await fetch('/api/visits').catch(() => null);
  if (!res || res.status === 404) {
    pane.innerHTML = '<p class="visits-empty">Visits need a Project Server, and this runner has none.</p>';
    return;
  }
  const visits = res.ok ? (await res.json()).visits ?? [] : [];
  const project = await currentProject();
  const groups = groupVisits(visits, project);

  const badge = document.getElementById('visits-badge');
  if (badge) {
    badge.textContent = String(groups.asking.length);
    badge.hidden = groups.asking.length === 0;
  }

  pane.innerHTML = '';
  for (const [key, title, actions] of GROUPS) {
    if (!groups[key].length) continue;
    const heading = document.createElement('div');
    heading.className = 'visits-heading';
    heading.textContent = title;
    pane.appendChild(heading);
    for (const visit of groups[key]) pane.appendChild(card(visit, actions, project));
  }
  if (!pane.children.length) {
    pane.innerHTML = '<p class="visits-empty">No visits to or from this team. Agents ask to visit '
      + 'when their work needs another team; the Project Designer says which teams may.</p>';
  }
  pane.appendChild(moveForm(groups));
}

/**
 * Moving an agent to another team for good, for admins. Its conversations
 * and schedule go with it; its logins stay; its open tickets here go back to
 * the backlog.
 */
function moveForm(groups) {
  const busy = new Set([...groups.away, ...groups.waiting, ...groups.visiting].map((v) => v.agent.name));
  const box = document.createElement('details');
  box.className = 'visit-move';
  box.innerHTML = `<summary>Move an agent to another team for good</summary>
    <div class="visit-move-row">
      <select class="visit-move-agent"></select>
      <span>to</span>
      <select class="visit-move-team"><option value="">Loading teams…</option></select>
    </div>
    <input class="visit-move-note" placeholder="Why (optional)" maxlength="200">
    <div class="visit-actions"><button class="visit-btn visit-move-go">Move</button></div>
    <div class="visit-error" hidden></div>`;

  const agentSelect = box.querySelector('.visit-move-agent');
  for (const agent of state.agents.filter((a) => !busy.has(a.name))) {
    agentSelect.appendChild(new Option(agent.name, agent.name));
  }
  box.addEventListener('toggle', () => {
    if (!box.open) return;
    fetch('/api/moves/targets').then((r) => r.json()).then(({ teams = [] }) => {
      const teamSelect = box.querySelector('.visit-move-team');
      teamSelect.innerHTML = '';
      for (const team of teams) teamSelect.appendChild(new Option(team.name, team.id));
      if (!teams.length) teamSelect.appendChild(new Option('No other teams', ''));
    }).catch(() => {});
  });

  box.querySelector('.visit-move-go').addEventListener('click', async () => {
    const agent = agentSelect.value;
    const to = box.querySelector('.visit-move-team').value;
    const error = box.querySelector('.visit-error');
    if (!agent || !to) return;
    if (!confirm(`Move ${agent} to ${to} for good? Their conversations and schedule go with them; `
      + 'their logins stay here, and their open tickets go back to the backlog.')) return;
    const res = await fetch('/api/moves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent, to, note: box.querySelector('.visit-move-note').value }),
    }).catch(() => null);
    if (!res || !res.ok) {
      const body = res ? await res.json().catch(() => ({})) : {};
      error.textContent = body.error ?? 'The runner is not answering.';
      error.hidden = false;
      return;
    }
    error.hidden = true;
    box.open = false;
  });
  return box;
}
