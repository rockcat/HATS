// ── One agent, in a browser ───────────────────────────────────────────────────
//
// Wiring only: the parts worth testing live in conversation.js, voice.js and
// device-tools.js, which touch no DOM and no network.
//
// The shape is the phone client's, because the phone client's shape was
// arrived at by fixing things: show what you said immediately, absorb the
// runner's echo of it, queue while offline, declare only the device tools that
// actually work, and never let a tool request go unanswered.

import { $, clear, el, toastError, toastOk } from '/ui-kit/hats-ui.js';
import { EmbodimentClient } from '/ui-kit/embodiment-client.js';
import { applyLipSync, showAvatar, stopLipSync } from '/ui-kit/avatar-stage.js';
import {
  arrived, delivered, emptyConversation, pending, saidByUser, statusLine, unsentCount,
} from '/conversation.js';
import {
  DeviceToolHost, cameraTool, deviceId, deviceTimeTool,
} from '/device-tools.js';
import {
  Hearing, Listener, SpeechMode, canListen, canSpeak, sentences, speakOnDevice, stopSpeaking,
} from '/voice.js';
import { HandsFree, Mode as HandsFreeMode } from '/hands-free.js';
import { faceTool } from '/face-tool.js';

const AGENT_KEY = 'hats.companion.agent';
const VOICE_KEY = 'hats.companion.voice';
const HANDS_FREE_KEY = 'hats.companion.handsFree';

const ui = {
  chooser:     $('#chooser'),
  chooserList: $('#chooser-list'),
  chooserHint: $('#chooser-hint'),
  companion:   $('#companion'),
  linkDot:     $('#link-dot'),
  agentName:   $('#agent-name'),
  agentState:  $('#agent-state'),
  banner:      $('#banner'),
  background:  $('#stage-background'),
  canvas:      $('#avatar-canvas'),
  stageHint:   $('#stage-hint'),
  transcript:  $('#transcript'),
  form:        $('#say-form'),
  earBtn:      $('#ear-btn'),
  earLabel:    $('#ear-label'),
  input:       $('#say-input'),
  micBtn:      $('#mic-btn'),
  sendBtn:     $('#send-btn'),
  cameraBtn:   $('#camera-btn'),
  voiceBtn:    $('#voice-btn'),
  voiceLabel:  $('#voice-label'),
  switchBtn:   $('#switch-btn'),
};

const client = new EmbodimentClient();
const state = {
  agent: null,
  conversation: emptyConversation(),
  online: false,
  speech: read(VOICE_KEY) ?? SpeechMode.device,
  device: null,
  camera: null,
  face: null,
  closeStream: null,
  beforeDictation: '',
};

function read(key) { try { return localStorage.getItem(key); } catch { return null; } }
function write(key, value) { try { localStorage.setItem(key, value); } catch { /* private window */ } }

// ── Choosing the agent, once ─────────────────────────────────────────────────

async function chooseAgent() {
  ui.chooser.hidden = false;
  ui.companion.hidden = true;

  let agents = [];
  try {
    agents = await client.agents();
  } catch (err) {
    ui.chooserHint.textContent = `Could not reach the runner: ${err.message}`;
    return;
  }

  if (agents.length === 0) {
    ui.chooserHint.textContent = 'No agents are running. Start a project on the runner first.';
    return;
  }

  ui.chooserHint.textContent = 'This page becomes that agent. You can switch later.';
  clear(ui.chooserList);
  for (const agent of agents) {
    ui.chooserList.append(el('button', {
      class: 'chooser-pick',
      onclick: () => { write(AGENT_KEY, agent.id); start(agent); },
    }, el('strong', {}, agent.name), el('span', { class: 'muted' }, agent.hatType ?? '')));
  }
}

// ── Becoming that agent ──────────────────────────────────────────────────────

async function start(agent) {
  state.agent = agent;
  state.conversation = emptyConversation();

  ui.chooser.hidden = true;
  ui.companion.hidden = false;
  ui.agentName.textContent = agent.name;
  renderTranscript();
  renderVoiceLabel();

  await showFace(agent);
  await loadHistory(agent);
  await becomeADevice();
  connect(agent);
}

async function showFace(agent) {
  const appearance = agent.appearance ?? {};
  ui.background.src = client.backgroundUrl(agent.id);
  ui.background.onerror = () => { ui.background.removeAttribute('src'); };

  try {
    const shown = await showAvatar(ui.canvas, {
      url: client.avatarUrl(agent.id),
      camera: appearance.camera,
      rotate: appearance.rotate,
      fov: appearance.fov,
      scale: appearance.scale,
    });
    ui.stageHint.hidden = shown;
    if (!shown) ui.stageHint.textContent = `${agent.name} has no avatar set.`;
  } catch {
    ui.stageHint.hidden = false;
    ui.stageHint.textContent = 'That avatar could not be loaded.';
  }
}

async function loadHistory(agent) {
  try {
    const history = await client.messages(agent.id, { limit: 50 });
    for (const message of history) {
      state.conversation = arrived(state.conversation, {
        role: message.role, content: message.content, from: message.from,
      });
    }
    renderTranscript();
  } catch { /* an empty transcript is a fine place to start */ }
}

// ── Being a device ───────────────────────────────────────────────────────────

/**
 * Offer face recognition, if this browser can actually do it.
 *
 * Loading the models takes a few seconds and a few megabytes, so it happens
 * after the rest of the device is declared rather than holding up the first
 * message. Failing is normal and silent: most installs will not have a
 * recognition model to hand.
 */
async function offerFaceRecognition() {
  const tool = await faceTool({ onProblem: (message) => console.info('[Face]', message) });
  if (!tool) return;

  state.face = tool;
  state.device.add(tool);
  state.device.capabilities = { ...state.device.capabilities, ...tool.capability };
  await state.device.declare();
}

async function becomeADevice() {
  state.device = new DeviceToolHost({
    client,
    deviceId: deviceId(),
    label: 'browser',
  });
  state.device.add(deviceTimeTool());

  // The camera is offered only once permission is actually granted. Declaring
  // it before then gives the agent a tool that can only fail.
  const granted = await cameraAlreadyAllowed();
  if (granted) await offerCamera();
  ui.cameraBtn.hidden = false;
  renderCameraButton();

  state.device.capabilities = {
    speech: { recognition: canListen(), synthesis: canSpeak() },
    ...(granted ? { camera: { lenses: ['back', 'front'] } } : {}),
    // Deliberately no faceEmbedding: nothing here can do it, and claiming it
    // would stop the runner embedding and leave it waiting for vectors.
  };
  await state.device.declare();

  // After declaring, not before: a tab that can recognise faces is still a
  // working companion while the models download.
  if (granted) void offerFaceRecognition();
}

/** Has the camera already been allowed, without prompting for it now? */
async function cameraAlreadyAllowed() {
  try {
    const status = await navigator.permissions?.query({ name: 'camera' });
    return status?.state === 'granted';
  } catch {
    // Firefox has no camera permission descriptor. Treat it as "ask later".
    return false;
  }
}

async function offerCamera() {
  if (state.camera) return true;
  state.camera = cameraTool({ onCapture: notePhoto });
  state.device.add(state.camera);
  return true;
}

async function askForCamera() {
  try {
    // Opening the stream is what prompts; close it straight away, the tool
    // opens its own when it is actually asked for a photo.
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    for (const track of stream.getTracks()) track.stop();
  } catch (err) {
    toastError(new Error('Without the camera I cannot see anything.'));
    return;
  }

  await offerCamera();
  state.device.capabilities = {
    ...state.device.capabilities,
    camera: { lenses: ['back', 'front'] },
  };
  await state.device.declare();
  renderCameraButton();
  toastOk('The agent can use the camera');
  // Permission just arrived, so this is the first moment it could work.
  void offerFaceRecognition();
}

/** A camera that fires with no trace is what costs an app the benefit of the doubt. */
function notePhoto(lens) {
  state.conversation = arrived(state.conversation, {
    role: 'tool',
    content: `Took a photo with the ${lens} camera.`,
  });
  renderTranscript();
}

// ── The live stream ──────────────────────────────────────────────────────────

function connect(agent) {
  state.closeStream?.();
  state.closeStream = client.stream({
    open:  () => setOnline(true),
    error: () => setOnline(false),

    agent_message: (event) => {
      if (event.agentId && event.agentId !== agent.id) return;
      state.conversation = arrived(state.conversation, {
        role: event.role ?? 'assistant', content: event.content, from: event.from,
      });
      renderTranscript();
      if (event.role !== 'user') speak(event.content);
    },

    agent_state: (event) => {
      if (event.agentId !== agent.id) return;
      // Not the activity verbatim: the runner sets it to the whole reply
      // when an agent responds, which puts a second copy of every answer
      // above the avatar.
      ui.agentState.textContent = statusLine(event.state, event.activity);
    },

    // The inverted call: the runner asking this tab to do something.
    device_request: (event) => { void state.device?.handle(event); },
  }, { agentId: agent.id, deviceId: state.device?.deviceId });
}

function setOnline(online) {
  state.online = online;
  ui.linkDot.classList.toggle('ok', online);
  renderBanner();
  if (online) void flushOutbox();
}

async function flushOutbox() {
  for (const text of pending(state.conversation)) {
    try {
      await client.send(state.agent.id, text);
      state.conversation = delivered(state.conversation, text);
    } catch {
      // Stop at the first failure rather than sending the rest out of order —
      // half a conversation in the wrong sequence reads as nonsense.
      break;
    }
  }
  renderTranscript();
  renderBanner();
}

// ── Saying something ─────────────────────────────────────────────────────────

async function say(text) {
  const trimmed = text.trim();
  if (!trimmed || !state.agent) return;

  // Shown *before* the send, not after. The runner broadcasts the message the
  // moment it records it, so the echo can land on the event stream while the
  // POST is still in flight — and if we have not registered it as ours by
  // then, it arrives looking like news and is shown a second time. Marked
  // undelivered until the send returns, so an offline message still reads
  // correctly.
  state.conversation = saidByUser(state.conversation, trimmed, { delivered: false });
  renderTranscript();
  renderBanner();

  try {
    await client.send(state.agent.id, trimmed);
    state.conversation = delivered(state.conversation, trimmed);
  } catch { /* stays queued, and flushes when the stream comes back */ }

  renderTranscript();
  renderBanner();
}

// ── Hearing ──────────────────────────────────────────────────────────────────

const listener = new Listener({
  onHeard: (text, isFinal) => {
    if (handsFree.enabled) {
      // Shown in the box as it firms up, so you can see you are being heard,
      // but it is hands-free that decides when the sentence is over.
      ui.input.value = text;
      handsFree.heard(text, isFinal);
      return;
    }
    // Into the field rather than held aside: recognition is usually nearly
    // right, and the fastest correction is the keyboard already on screen.
    const join = !state.beforeDictation || state.beforeDictation.endsWith(' ') ? '' : ' ';
    ui.input.value = state.beforeDictation + join + text;
  },
  onState: () => renderMic(),
  onEnd: () => handsFree.recogniserEnded(),
  onError: (message) => {
    // A refused microphone is permanent until the user changes it, so an
    // always-on mode that keeps restarting would toast forever.
    if (handsFree.enabled) handsFree.disable();
    renderMic();
    toastError(new Error(message));
  },
});

/**
 * Always-on listening.
 *
 * The sentence goes straight out when you stop talking — no button, no Enter
 * — which is the only way the thing reads as a conversation rather than a
 * form you dictate into.
 */
const handsFree = new HandsFree({
  listener,
  onUtterance: async (text) => {
    ui.input.value = '';
    state.beforeDictation = '';
    await say(text);
  },
  onMode: () => renderMic(),
});

function toggleListening() {
  // Hands-free owns the microphone while it is on, so the button means
  // "stop" rather than "start a one-off".
  if (handsFree.enabled) { setHandsFree(false); return; }

  if (listener.isListening) {
    listener.stop();
  } else {
    state.beforeDictation = ui.input.value;
    listener.start();
  }
  renderMic();
}

function setHandsFree(on) {
  if (on && !canListen()) {
    toastError(new Error('This browser has no speech recognition. Chrome has it; Firefox does not.'));
    return;
  }
  if (on) {
    // A one-off dictation already in progress would otherwise fight it for
    // the same recogniser.
    listener.cancel();
    ui.input.value = '';
    state.beforeDictation = '';
    handsFree.enable();
  } else {
    handsFree.disable();
  }
  write(HANDS_FREE_KEY, on ? '1' : '');
  renderMic();
}

// ── Speaking ─────────────────────────────────────────────────────────────────

async function speak(text) {
  if (state.speech === SpeechMode.off || !text?.trim()) return;
  stopTalking();

  // The reply comes out of the speakers the microphone is pointed at. Without
  // this the agent transcribes its own voice, answers it, and talks to itself
  // until the tab is closed. With the voice off there is nothing to hear, so
  // the microphone stays open and you can interrupt.
  handsFree.hold();
  try {
    await speakAloud(text);
  } finally {
    handsFree.release();
  }
}

async function speakAloud(text) {
  if (state.speech === SpeechMode.device) {
    // No viseme data from the browser's voice, so the mouth moves
    // approximately rather than not at all.
    applyLipSync(null);
    try {
      // Sentence at a time, so the first words start while the rest is still
      // being prepared.
      for (const sentence of sentences(text)) await speakOnDevice(sentence);
    } finally {
      stopLipSync();
    }
    return;
  }

  try {
    // Chunks of base64 WAV, one per sentence, each with mouth shapes. There
    // is no URL to hand an <audio> tag — the first version of this looked for
    // an `audioUrl` the API has never returned, so the server voice was
    // silently doing nothing at all.
    const { chunks = [] } = await client.speak(state.agent.id, text);
    for (const chunk of chunks) {
      if (state.speech !== SpeechMode.server) break;  // switched voices mid-reply
      await playWav(chunk.audioBase64, chunk.visemes);
    }
  } catch {
    // The server voice is a round trip and can fail. The words are on screen
    // either way, so this is not worth interrupting anybody about.
  }
}

/**
 * Stop talking, whichever voice is talking.
 *
 * stopSpeaking() only reaches the browser's synthesiser; a server chunk is
 * an <audio> element and carries on regardless, which is how you end up
 * with two voices after switching.
 */
function stopTalking() {
  stopSpeaking();
  try { state.playing?.pause(); } catch { /* nothing was playing */ }
  state.playing = null;
  stopLipSync();
}

/**
 * Play one base64 WAV and mouth it, resolving when it finishes or fails.
 *
 * The mouth starts on `playing`, not when the audio is created: there is a
 * gap between asking for sound and hearing it, and starting the timeline at
 * the request would bake that gap in as permanent drift.
 */
function playWav(base64, visemes) {
  if (!base64) return Promise.resolve();
  return new Promise((resolve) => {
    const audio = new Audio(`data:audio/wav;base64,${base64}`);
    state.playing = audio;

    audio.onplaying = () => applyLipSync(visemes);
    const done = () => { stopLipSync(); resolve(); };
    // Resolve on error as well as on end: one chunk failing must not leave
    // the rest of the reply unspoken, or the mouth hanging open.
    audio.onended = done;
    audio.onerror = done;
    audio.play().catch(done);
  });
}

function cycleVoice() {
  const order = [SpeechMode.device, SpeechMode.server, SpeechMode.off];
  const next = order[(order.indexOf(state.speech) + 1) % order.length];
  state.speech = next;
  write(VOICE_KEY, next);
  stopTalking();
  renderVoiceLabel();
}

// ── Rendering ────────────────────────────────────────────────────────────────

function renderTranscript() {
  clear(ui.transcript);
  for (const message of state.conversation.messages) {
    ui.transcript.append(el('div', {
      class: `line ${message.role}${message.pending ? ' pending' : ''}`,
    },
      el('span', { class: 'who' }, message.role === 'user' ? 'You'
        : message.role === 'tool' ? '' : (state.agent?.name ?? 'Agent')),
      el('span', { class: 'what' }, message.content),
    ));
  }
  ui.transcript.scrollTop = ui.transcript.scrollHeight;
}

function renderBanner() {
  const waiting = unsentCount(state.conversation);
  if (state.online && waiting === 0) { ui.banner.hidden = true; return; }
  ui.banner.hidden = false;
  ui.banner.textContent = state.online
    ? `Reconnected — sending ${waiting} message${waiting === 1 ? '' : 's'}.`
    : waiting > 0
      ? `Not connected. ${waiting} message${waiting === 1 ? '' : 's'} waiting to send.`
      : 'Not connected to the runner.';
}

function renderMic() {
  const listening = listener.state !== Hearing.idle;
  const hands = handsFree.enabled;

  ui.micBtn.classList.toggle('recording', listening && !hands);
  ui.micBtn.title = hands ? 'Stop listening'
    : listening ? 'Stop listening' : 'Speak';
  ui.micBtn.disabled = !canListen();
  if (!canListen()) ui.micBtn.title = 'This browser has no speech recognition';

  ui.earBtn.disabled = !canListen();
  ui.earBtn.classList.toggle('ok', hands);
  ui.earBtn.classList.toggle('held', hands && handsFree.held);
  ui.earLabel.textContent = !hands ? 'Hands-free'
    : handsFree.held ? 'Speaking…'
    : handsFree.mode === HandsFreeMode.hearing ? 'Heard you…'
    : 'Listening';
  ui.earBtn.title = !canListen() ? 'This browser has no speech recognition'
    : hands ? 'Stop listening all the time'
    : 'Keep listening and send what you say';

  // Typing is still allowed, but the placeholder should not claim the box is
  // the only way in when it is not.
  ui.input.placeholder = hands ? 'Listening — just talk' : 'Say something…';
}

function renderVoiceLabel() {
  ui.voiceLabel.textContent = state.speech === SpeechMode.device ? 'This device'
    : state.speech === SpeechMode.server ? 'Server voice' : 'Silent';
  ui.voiceBtn.classList.toggle('muted-btn', state.speech === SpeechMode.off);
}

function renderCameraButton() {
  const offered = !!state.camera;
  ui.cameraBtn.classList.toggle('ok', offered);
  ui.cameraBtn.title = offered
    ? 'The agent can use the camera'
    : 'Let the agent use the camera';
}

// ── Start ────────────────────────────────────────────────────────────────────

ui.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (handsFree.enabled) {
    // Typed over the top of what was heard. Dropping the pending utterance
    // stops the same words being sent again a moment later, and the
    // microphone stays open rather than being switched off by sending.
    handsFree.dismiss();
  } else if (listener.isListening) {
    // Sending while still listening counts what was just said: the
    // recogniser's last word usually lands before the stop does.
    listener.stop();
  }

  const text = ui.input.value;
  ui.input.value = '';
  state.beforeDictation = '';
  await say(text);
});

ui.micBtn.addEventListener('click', toggleListening);
ui.earBtn.addEventListener('click', () => setHandsFree(!handsFree.enabled));
ui.voiceBtn.addEventListener('click', cycleVoice);
ui.cameraBtn.addEventListener('click', askForCamera);
ui.switchBtn.addEventListener('click', async () => {
  state.closeStream?.();
  await state.device?.withdraw();
  write(AGENT_KEY, '');
  await chooseAgent();
});

// Leaving should withdraw rather than letting the runner discover it: a device
// that vanishes keeps its tools offered until the stream times out.
// Picked up again on the next visit: somebody who wants to talk rather than
// type wants that every time, not once.
if (read(HANDS_FREE_KEY) === '1' && canListen()) setHandsFree(true);

window.addEventListener('pagehide', () => {
  state.camera?.close?.();
  state.face?.close?.();
  navigator.sendBeacon?.(
    `${client.basePath}/devices/${encodeURIComponent(state.device?.deviceId ?? '')}`,
  );
});

(async function boot() {
  renderMic();
  let configured = '';
  try {
    configured = (await (await fetch('/api/v1/config')).json()).agentName ?? '';
  } catch { /* the page still works, it just has to ask */ }

  const wanted = configured || read(AGENT_KEY);
  if (wanted) {
    try {
      const agents = await client.agents();
      const found = agents.find((a) => a.id === wanted)
        ?? agents.find((a) => a.name.toLowerCase() === wanted.toLowerCase());
      if (found) { await start(found); return; }
    } catch { /* fall through to the chooser, which reports the problem */ }
  }
  await chooseAgent();
})();
