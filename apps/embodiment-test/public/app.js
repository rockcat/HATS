/** Embodiment API test harness — talks to nothing but the Embodiment API. */

import { $, clear, el, hatDots, toastError, toastOk, trackHealth } from '/ui-kit/hats-ui.js';
import { call, clearLog, logEvent } from '/wire-log.js';

const API = '/runner/api/embodiment/v1';

const state = {
  agents: [],
  selectedId: null,
  thread: 'general',
  lastReply: '',
  stream: null,
};

const ui = {
  list:        $('#agent-list'),
  empty:       $('#agent-empty'),
  count:       $('#agent-count'),
  title:       $('#chat-title'),
  transcript:  $('#transcript'),
  chatEmpty:   $('#chat-empty'),
  threads:     $('#thread-select'),
  input:       $('#message-input'),
  send:        $('#send-button'),
  speak:       $('#speak-last'),
  stateLine:   $('#agent-state-line'),
  streamState: $('#stream-state'),
  projectLine: $('#project-line'),
  player:      $('#speech-player'),
};

const selected = () => state.agents.find((a) => a.id === state.selectedId);

// ── Loading ──────────────────────────────────────────────────────────────────

async function loadProject() {
  try {
    const project = await call('GET', `${API}/project`);
    ui.projectLine.textContent = project.goal
      ? `${project.name} — ${project.goal}`
      : `${project.name} (${project.agentCount} agents, via ${project.source})`;
  } catch (err) {
    ui.projectLine.textContent = 'no project loaded';
    toastError(err);
  }
}

async function loadAgents() {
  try {
    const result = await call('GET', `${API}/agents`);
    state.agents = result?.agents ?? [];
  } catch (err) {
    state.agents = [];
    toastError(err);
  }
  renderRoster();
}

async function loadThread() {
  const agent = selected();
  if (!agent) return;
  const result = await call('GET', `${API}/agents/${agent.id}/messages?thread=${encodeURIComponent(state.thread)}&limit=200`);
  renderTranscript(result?.messages ?? []);
}

async function loadThreadList() {
  const agent = selected();
  if (!agent) return;
  const result = await call('GET', `${API}/agents/${agent.id}/threads`);
  const threads = Object.keys(result?.threads ?? {});
  if (!threads.includes('general')) threads.unshift('general');
  ui.threads.replaceChildren(...threads.map((t) =>
    el('option', { value: t, selected: t === state.thread }, `${t} (${result?.threads?.[t] ?? 0})`)));
}

// ── Rendering ────────────────────────────────────────────────────────────────

function renderRoster() {
  ui.count.textContent = String(state.agents.length);
  ui.empty.hidden = state.agents.length > 0;
  clear(ui.list);

  for (const agent of state.agents) {
    ui.list.append(el('li', {
      'aria-selected': agent.id === state.selectedId,
      onclick: () => void selectAgent(agent.id),
    },
      el('span', { class: 'hats' }, ...hatDots(agent.hats)),
      el('span', { class: 'grow' },
        el('div', { class: 'name' }, agent.name),
        el('div', { class: 'meta' }, agent.activity || agent.state),
      ),
      el('span', { class: 'badges' },
        agent.hasVoice ? el('span', { class: 'tag', title: 'has a TTS voice' }, '🔊') : null,
        agent.hasAvatar ? el('span', { class: 'tag', title: 'has a 3D avatar' }, '🙂') : null,
      ),
    ));
  }
}

function renderTranscript(messages) {
  ui.chatEmpty.hidden = true;
  clear(ui.transcript);
  const agent = selected();

  for (const message of messages) {
    const who = message.role === 'user' ? 'You' : message.toolName ? `tool · ${message.toolName}` : agent?.name;
    ui.transcript.append(el('div', { class: `bubble ${message.role}` },
      el('span', { class: 'who' }, `${who} · ${new Date(message.timestamp).toLocaleTimeString()}`),
      message.content,
    ));
  }
  const last = [...messages].reverse().find((m) => m.role === 'assistant');
  state.lastReply = last?.content ?? '';
  ui.speak.disabled = !state.lastReply || !agent?.hasVoice;
  ui.transcript.scrollTop = ui.transcript.scrollHeight;
}

function appendBubble(role, who, content, extraClass = '') {
  ui.chatEmpty.hidden = true;
  const node = el('div', { class: `bubble ${role} ${extraClass}`.trim() },
    el('span', { class: 'who' }, `${who} · ${new Date().toLocaleTimeString()}`),
    content,
  );
  ui.transcript.append(node);
  ui.transcript.scrollTop = ui.transcript.scrollHeight;
  return node;
}

// ── Actions ──────────────────────────────────────────────────────────────────

async function selectAgent(id) {
  state.selectedId = id;
  state.thread = 'general';
  const agent = selected();
  ui.title.textContent = `${agent.name} — ${agent.hats.join(', ')}`;
  ui.stateLine.textContent = agent.state;
  ui.input.disabled = false;
  ui.send.disabled = false;
  renderRoster();
  await loadThreadList();
  await loadThread();
  ui.input.focus();
}

async function send(event) {
  event.preventDefault();
  const agent = selected();
  const content = ui.input.value.trim();
  if (!agent || !content) return;

  const mode = document.querySelector('input[name="mode"]:checked').value;
  ui.input.value = '';
  appendBubble('user', 'You', content);
  const pending = appendBubble('assistant', agent.name, mode === 'task' ? 'task accepted…' : 'thinking…', 'pending');

  try {
    await call('POST', `${API}/agents/${agent.id}/messages`, { content, thread: state.thread, mode });
    // The reply arrives over the stream; drop the placeholder once it does.
    setTimeout(() => pending.remove(), 800);
  } catch (err) {
    pending.remove();
    toastError(err);
  }
}

async function speakLast() {
  const agent = selected();
  if (!agent || !state.lastReply) return;
  try {
    const blob = await call('POST', `${API}/agents/${agent.id}/speech`, { text: state.lastReply.slice(0, 500) });
    if (!(blob instanceof Blob)) { toastError(new Error('No audio returned')); return; }
    ui.player.src = URL.createObjectURL(blob);
    await ui.player.play();
    toastOk('Playing synthesised speech');
  } catch (err) {
    toastError(err);
  }
}

// ── Live stream ──────────────────────────────────────────────────────────────

function openStream() {
  state.stream?.close();
  const source = new EventSource(`${API}/events`);
  state.stream = source;

  source.onopen = () => { ui.streamState.textContent = 'stream: open'; ui.streamState.className = 'tag ok'; };
  source.onerror = () => { ui.streamState.textContent = 'stream: retrying'; ui.streamState.className = 'tag error'; };

  source.addEventListener('hello', (event) => {
    const payload = JSON.parse(event.data);
    logEvent('hello', `${payload.agents?.length ?? 0} agents`);
    state.agents = payload.agents ?? [];
    renderRoster();
  });

  source.addEventListener('agent_state', (event) => {
    const payload = JSON.parse(event.data);
    logEvent('agent_state', `${payload.name} → ${payload.state}`);
    const agent = state.agents.find((a) => a.id === payload.agentId);
    if (agent) { agent.state = payload.state; agent.activity = payload.activity; }
    if (payload.agentId === state.selectedId) ui.stateLine.textContent = payload.state;
    renderRoster();
  });

  source.addEventListener('agent_message', (event) => {
    const payload = JSON.parse(event.data);
    logEvent('agent_message', `${payload.name} · ${payload.thread}`);
    if (payload.agentId !== state.selectedId || payload.thread !== state.thread) return;
    if (payload.role === 'assistant') {
      ui.transcript.querySelector('.bubble.pending')?.remove();
      state.lastReply = payload.content;
      ui.speak.disabled = !selected()?.hasVoice;
    }
    appendBubble(payload.role, payload.role === 'user' ? 'You' : payload.name, payload.content);
  });

  source.addEventListener('agent_speech', (event) => {
    const payload = JSON.parse(event.data);
    logEvent('agent_speech', `${payload.name} · ${payload.visemes?.length ?? 0} visemes`);
  });

  source.addEventListener('project_update', () => { logEvent('project_update'); void loadProject(); });
}

// ── Wiring ───────────────────────────────────────────────────────────────────

$('#send-form').addEventListener('submit', (event) => void send(event));
$('#refresh-agents').addEventListener('click', () => void loadAgents());
$('#clear-log').addEventListener('click', clearLog);
ui.speak.addEventListener('click', () => void speakLast());
ui.threads.addEventListener('change', () => {
  state.thread = ui.threads.value.split(' ')[0];
  void loadThread();
});

trackHealth($('#runner-dot'), $('#runner-label'), `${API}/health`);

await loadProject();
await loadAgents();
openStream();
