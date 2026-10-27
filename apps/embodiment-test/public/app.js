/**
 * Embodiment API test harness.
 *
 * Conversation, state and speech go through the Embodiment API and nothing
 * else — that is what this app exists to prove, and the wire log on the right
 * is the proof. The Agent Template Library is read for one thing only: so the roster
 * lists every agent that exists, not just the ones the current project happens
 * to be running. Both upstreams are optional and neither knows about the other.
 */

import { $, el, toastError, trackHealth } from '/ui-kit/hats-ui.js';
import { clearLog, logEvent, logRequest } from '/wire-log.js';
import { EmbodimentClient } from '/ui-kit/embodiment-client.js';
import { filterRoster, mergeRoster, renderRoster } from '/roster.js';
import { loadCatalogue, previewVoice, showRow } from '/stage.js';

const runner = new EmbodimentClient({
  basePath: '/runner/api/embodiment/v1',
  onRequest: (method, path, status) => logRequest(method, path, status),
});

const state = {
  rows: [],
  live: [],
  templates: [],
  selectedKey: null,
  thread: 'general',
  lastReply: '',
  stream: null,
};

const ui = {
  list:        $('#agent-list'),
  empty:       $('#agent-empty'),
  count:       $('#agent-count'),
  search:      $('#agent-search'),
  liveOnly:    $('#live-only'),
  title:       $('#chat-title'),
  transcript:  $('#transcript'),
  chatEmpty:   $('#chat-empty'),
  threads:     $('#thread-select'),
  input:       $('#message-input'),
  send:        $('#send-button'),
  speak:       $('#speak-last'),
  voice:       $('#preview-voice'),
  stateLine:   $('#agent-state-line'),
  note:        $('#composer-note'),
  streamState: $('#stream-state'),
  projectLine: $('#project-line'),
  player:      $('#speech-player'),
};

const selected = () => state.rows.find((row) => row.key === state.selectedKey) ?? null;

// ── Loading ──────────────────────────────────────────────────────────────────

async function loadProject() {
  try {
    const project = await runner.project();
    ui.projectLine.textContent = project.goal
      ? `${project.name} — ${project.goal}`
      : `${project.name} (${project.agentCount} agents, via ${project.source})`;
  } catch {
    ui.projectLine.textContent = 'no project loaded';
  }
}

/** Every template in the library. Absent library simply means fewer rows. */
async function loadTemplates() {
  try {
    const response = await fetch('/library/api/v1/agent-templates');
    logRequest('GET', '/library/agent-templates', response.status);
    state.templates = response.ok ? (await response.json()).templates ?? [] : [];
  } catch {
    state.templates = [];
  }
}

async function loadAgents() {
  try {
    state.live = await runner.agents();
  } catch (err) {
    state.live = [];
    toastError(err);
  }
  await loadTemplates();
  rebuild();
}

async function loadThread() {
  const row = selected();
  if (!row?.live) return;
  renderTranscript(await runner.messages(row.live.id, { thread: state.thread, limit: 200 }));
}

async function loadThreadList() {
  const row = selected();
  if (!row?.live) { ui.threads.replaceChildren(); return; }
  const threads = await runner.threads(row.live.id);
  const names = Object.keys(threads);
  if (!names.includes('general')) names.unshift('general');
  ui.threads.replaceChildren(...names.map((name) =>
    el('option', { value: name, selected: name === state.thread }, `${name} (${threads[name] ?? 0})`)));
}

// ── Rendering ────────────────────────────────────────────────────────────────

function rebuild() {
  state.rows = mergeRoster(state.live, state.templates);
  paintRoster();
}

function paintRoster() {
  const rows = filterRoster(state.rows, {
    search: ui.search.value,
    liveOnly: ui.liveOnly.checked,
  });
  renderRoster(ui.list, ui.empty, ui.count, rows, {
    selectedKey: state.selectedKey,
    onSelect: (row) => void selectAgent(row),
  });
}

function renderTranscript(messages) {
  ui.chatEmpty.hidden = true;
  ui.transcript.replaceChildren();
  const row = selected();

  for (const message of messages) {
    const who = message.role === 'user' ? 'You' : message.toolName ? `tool · ${message.toolName}` : row?.name;
    appendBubble(message.role, who, message.content, '', new Date(message.timestamp));
  }
  const last = [...messages].reverse().find((m) => m.role === 'assistant');
  state.lastReply = last?.content ?? '';
  ui.speak.disabled = !state.lastReply || !row?.identity?.voice;
  ui.transcript.scrollTop = ui.transcript.scrollHeight;
}

function appendBubble(role, who, content, extraClass = '', at = new Date()) {
  ui.chatEmpty.hidden = true;
  const node = el('div', { class: `bubble ${role} ${extraClass}`.trim() },
    el('span', { class: 'who' }, `${who} · ${at.toLocaleTimeString()}`),
    content,
  );
  ui.transcript.append(node);
  ui.transcript.scrollTop = ui.transcript.scrollHeight;
  return node;
}

// ── Actions ──────────────────────────────────────────────────────────────────

/**
 * Only a deployed agent can hold a conversation — there is no instance behind a
 * library template to send a message to. The composer says so rather than
 * failing on send.
 */
function setConversationEnabled(row) {
  const live = Boolean(row?.live);
  ui.input.disabled = !live;
  ui.send.disabled = !live;
  ui.threads.disabled = !live;
  ui.speak.disabled = !live || !state.lastReply;
  ui.note.textContent = live
    ? ''
    : 'In the library, not deployed — add it to the running project to chat.';
}

async function selectAgent(row) {
  state.selectedKey = row.key;
  state.thread = 'general';
  state.lastReply = '';
  ui.title.textContent = row.hats?.length ? `${row.name} — ${row.hats.join(', ')}` : row.name;
  ui.stateLine.textContent = row.live?.state ?? '';
  paintRoster();

  void showRow(row, runner);
  setConversationEnabled(row);

  if (!row.live) {
    ui.transcript.replaceChildren(ui.chatEmpty);
    ui.chatEmpty.hidden = false;
    ui.chatEmpty.textContent = `${row.name} is not deployed. Its face and voice still work.`;
    return;
  }

  ui.chatEmpty.textContent = 'No messages in this thread yet.';
  await loadThreadList();
  await loadThread();
  ui.input.focus();
}

async function send(event) {
  event.preventDefault();
  const row = selected();
  const content = ui.input.value.trim();
  if (!row?.live || !content) return;

  const mode = document.querySelector('input[name="mode"]:checked').value;
  ui.input.value = '';
  appendBubble('user', 'You', content);
  const pending = appendBubble('assistant', row.name, mode === 'task' ? 'task accepted…' : 'thinking…', 'pending');

  try {
    await runner.send(row.live.id, content, { thread: state.thread, mode });
    // The reply arrives over the stream; drop the placeholder once it does.
    setTimeout(() => pending.remove(), 800);
  } catch (err) {
    pending.remove();
    toastError(err);
  }
}

async function speakLast() {
  const row = selected();
  if (!row?.live || !state.lastReply) return;
  try {
    const blob = await runner.speak(row.live.id, state.lastReply.slice(0, 500));
    if (!(blob instanceof Blob)) { toastError(new Error('No audio returned')); return; }
    ui.player.src = URL.createObjectURL(blob);
    await ui.player.play();
  } catch (err) {
    toastError(err);
  }
}

// ── Live stream ──────────────────────────────────────────────────────────────

function openStream() {
  state.stream?.();
  state.stream = runner.stream({
    open:  () => { ui.streamState.textContent = 'stream: open';     ui.streamState.className = 'tag ok'; },
    error: () => { ui.streamState.textContent = 'stream: retrying'; ui.streamState.className = 'tag error'; },

    hello: (payload) => {
      logEvent('hello', `${payload.agents?.length ?? 0} agents`);
      state.live = payload.agents ?? [];
      rebuild();
    },

    agent_state: (payload) => {
      logEvent('agent_state', `${payload.name} → ${payload.state}`);
      const agent = state.live.find((a) => a.id === payload.agentId);
      if (agent) { agent.state = payload.state; agent.activity = payload.activity; }
      if (selected()?.live?.id === payload.agentId) ui.stateLine.textContent = payload.state;
      rebuild();
    },

    agent_message: (payload) => {
      logEvent('agent_message', `${payload.name} · ${payload.thread}`);
      const row = selected();
      if (payload.agentId !== row?.live?.id || payload.thread !== state.thread) return;
      if (payload.role === 'assistant') {
        ui.transcript.querySelector('.bubble.pending')?.remove();
        state.lastReply = payload.content;
        ui.speak.disabled = !row.identity?.voice;
      }
      appendBubble(payload.role, payload.role === 'user' ? 'You' : payload.name, payload.content);
    },

    agent_speech: (payload) => {
      logEvent('agent_speech', `${payload.name} · ${payload.visemes?.length ?? 0} visemes`);
    },

    project_update: () => { logEvent('project_update'); void loadProject(); },
  });
}

// ── Wiring ───────────────────────────────────────────────────────────────────

$('#send-form').addEventListener('submit', (event) => void send(event));
$('#refresh-agents').addEventListener('click', () => void loadAgents());
$('#clear-log').addEventListener('click', clearLog);
ui.search.addEventListener('input', paintRoster);
ui.liveOnly.addEventListener('change', paintRoster);
ui.speak.addEventListener('click', () => void speakLast());
ui.voice.addEventListener('click', () => void previewVoice(selected(), runner));
ui.threads.addEventListener('change', () => {
  state.thread = ui.threads.value.split(' ')[0];
  void loadThread();
});

trackHealth($('#runner-dot'), $('#runner-label'), `${runner.basePath}/health`);
trackHealth($('#library-dot'), $('#library-label'), '/library/api/v1/health');

await loadCatalogue();
await loadProject();
await loadAgents();
openStream();
