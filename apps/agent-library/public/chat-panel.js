/**
 * Chat with a deployed instance of the template being edited.
 *
 * A template is a definition, not a process — there is nothing to talk to until
 * it has been deployed into a project and the Team Runner has embodied it. So
 * this panel resolves the template to a running agent through the Embodiment
 * API and says plainly when it cannot.
 */

import { $, clear, el, toastError } from '/ui-kit/hats-ui.js';

const RUNNER = '/runner/api/embodiment/v1';

let agentId = null;
let templateName = null;
let stream = null;

async function runnerFetch(path, options) {
  const res = await fetch(`${RUNNER}${path}`, options);
  if (res.status === 401) throw new Error('The Team Runner rejected the request — set HATS_API_KEY for this service.');
  if (res.status === 502 || res.status === 504) throw new Error('The Team Runner is not running.');
  if (!res.ok && res.status !== 202) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

function setStatus(text, kind = '') {
  const node = $('#chat-status');
  node.textContent = text;
  node.className = `tag ${kind}`;
}

function bubble(role, who, content) {
  const node = el('div', { class: `bubble ${role}` },
    el('span', { class: 'who' }, `${who} · ${new Date().toLocaleTimeString()}`),
    content);
  const log = $('#chat-log');
  log.append(node);
  log.scrollTop = log.scrollHeight;
  return node;
}

/**
 * Find a running agent for this template. The runner reports deployed agents by
 * instanceId, so match on name — the deployed copy keeps the template's name
 * unless it was renamed for the project.
 */
async function resolveAgent(name) {
  const { agents } = await runnerFetch('/agents');
  const needle = name.trim().toLowerCase();
  return agents.find((a) => a.name.toLowerCase() === needle)
      ?? agents.find((a) => a.name.toLowerCase().startsWith(needle))
      ?? null;
}

function openStream() {
  stream?.close();
  if (!agentId) return;
  stream = new EventSource(`${RUNNER}/events?agentId=${encodeURIComponent(agentId)}`);
  stream.addEventListener('agent_message', (event) => {
    const payload = JSON.parse(event.data);
    if (payload.agentId !== agentId || payload.thread !== 'general') return;
    $('#chat-log').querySelector('.bubble.pending')?.remove();
    bubble(payload.role, payload.role === 'user' ? 'You' : payload.name, payload.content);
  });
  stream.addEventListener('agent_state', (event) => {
    const payload = JSON.parse(event.data);
    if (payload.agentId === agentId) setStatus(payload.state, payload.state === 'idle' ? 'ok' : '');
  });
}

async function loadHistory() {
  const { messages } = await runnerFetch(`/agents/${agentId}/messages?thread=general&limit=50`);
  clear($('#chat-log'));
  for (const m of messages) {
    bubble(m.role, m.role === 'user' ? 'You' : templateName, m.content);
  }
}

async function send(event) {
  event.preventDefault();
  const input = $('#chat-input');
  const content = input.value.trim();
  if (!content || !agentId) return;
  input.value = '';
  bubble('user', 'You', content);
  const pending = bubble('assistant', templateName, 'thinking…');
  pending.classList.add('pending');
  try {
    await runnerFetch(`/agents/${agentId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, thread: 'general' }),
    });
  } catch (err) {
    pending.remove();
    toastError(err);
  }
}

/** Point the chat panel at a template. Pass null to clear it. */
export async function showChatFor(template) {
  stream?.close();
  stream = null;
  agentId = null;
  templateName = template?.name ?? null;

  const form = $('#chat-form');
  const log = $('#chat-log');
  clear(log);

  if (!template) {
    form.hidden = true;
    setStatus('no template', '');
    $('#chat-hint').hidden = false;
    $('#chat-hint').textContent = 'Select a template to chat with it.';
    return;
  }

  try {
    const agent = await resolveAgent(template.name);
    if (!agent) {
      form.hidden = true;
      setStatus('not deployed', 'warn');
      $('#chat-hint').hidden = false;
      $('#chat-hint').textContent =
        `${template.name} is not running. Deploy it into a project in the Project Designer, set that project active, and start the Team Runner.`;
      return;
    }
    agentId = agent.id;
    form.hidden = false;
    $('#chat-hint').hidden = true;
    setStatus(agent.state, agent.state === 'idle' ? 'ok' : '');
    await loadHistory();
    openStream();
  } catch (err) {
    form.hidden = true;
    setStatus('unavailable', 'error');
    $('#chat-hint').hidden = false;
    $('#chat-hint').textContent = err.message;
  }
}

export function initChat() {
  $('#chat-form').addEventListener('submit', (event) => void send(event));
}
