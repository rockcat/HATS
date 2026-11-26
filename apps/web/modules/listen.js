// ── Listen mode ──────────────────────────────────────────────────────────────
//
// The ear button beside Mute. While it is on, the microphone stays open and
// each thing said, ended by a pause, is turned into text and sent to whatever
// is open: a meeting on screen, or the agent chosen in the Chat section (its
// open thread, or #general). With nothing open, what is said is not recorded,
// and never reaches the transcription service.
//
// It stays deaf while an agent is speaking out loud, so it never sends an
// agent its own words; the browser's echo cancellation covers the rest.
//
// Where speech goes and when it starts and stops are decided in
// listen-logic.js; this is the part with a microphone and a page.

import { listenTarget, describeTarget, vadStep, VAD, QUIET, nextFloor, thresholdFor } from './listen-logic.js';
import { isSpeechPlaying } from './speech-activity.js';
import { transcribe } from './transcribe.js';
import { notify } from './notice.js';

const TICK_MS = 50;
/** This long with not one non-zero sample means the input is broken. */
const SILENT_MIC_MS = 4000;

let session = null;   // { stream, ctx, analyser, samples, timer, vad, recorder, chunks, target }
let status = 'off';   // off | listening | hearing | transcribing

// The header's, and the meeting's: a meeting covers the header.
const button = () => document.getElementById('listen-btn');
const meetingButton = () => document.getElementById('meeting-listen-btn');
const say = (text) => notify(text, 'error');

/** What is on screen now, as listen-logic reads it. */
function page() {
  const overlay = document.getElementById('meeting-overlay');
  const input = document.getElementById('meeting-human-input');
  const threads = document.getElementById('chat-threads');
  const detailModal = document.getElementById('agent-detail-modal');
  const detail = document.getElementById('agent-detail-threads');
  const detailOpen = !!detailModal && !detailModal.hidden;
  return {
    meetingOpen: !!overlay && !overlay.hidden && !!input && !input.hidden,
    detailAgent: detailOpen ? detail?.getAttribute('agent') || null : null,
    detailThread: detailOpen ? detail?.activeThread ?? null : null,
    view: document.querySelector('#view-host > .view.active')?.dataset.view ?? null,
    chatAgent: document.getElementById('chat-agent-select')?.value || null,
    chatThread: threads?.activeThread ?? null,
  };
}

function show() {
  const btn = button();
  if (!btn) return;
  const on = status !== 'off';
  const target = on ? listenTarget(page()) : null;
  btn.classList.toggle('listen-btn--on', on);
  btn.classList.toggle('listen-btn--nowhere', on && !target && status === 'listening');
  btn.classList.toggle('listen-btn--hearing', status === 'hearing');
  btn.classList.toggle('listen-btn--busy', status === 'transcribing');
  btn.setAttribute('aria-pressed', String(on));
  btn.title = status === 'off' ? 'Listen: talk to the open chat or meeting'
    : status === 'hearing' ? 'Hearing you…'
    : status === 'transcribing' ? 'Turning that into text…'
    : `Listening, ${describeTarget(target)}. ${loudness()} Click to stop.`;
  btn.setAttribute('aria-label', btn.title);
  btn.style.setProperty('--listen-level', on && session ? String(Math.min(1, session.level / session.threshold)) : '0');

  const inMeeting = meetingButton();
  if (inMeeting) {
    inMeeting.classList.toggle('active', on);
    inMeeting.setAttribute('aria-pressed', String(on));
    inMeeting.title = btn.title;
  }
}

/** What the microphone hears, against what counts as speech, in words. */
function loudness() {
  if (!session) return '';
  const pct = Math.round((100 * session.level) / session.threshold);
  return `Microphone at ${pct}% of speaking level.`;
}

function setStatus(next) {
  status = next;
  show();
}

/** Loudness of what the microphone hears now, 0–1. */
function level(s) {
  s.analyser.getFloatTimeDomainData(s.samples);
  let sum = 0;
  for (const v of s.samples) sum += v * v;
  return Math.sqrt(sum / s.samples.length);
}

function startRecording(s, target) {
  s.chunks = [];
  s.target = target;
  s.recorder = new MediaRecorder(s.stream);
  s.recorder.ondataavailable = (e) => { if (e.data.size > 0) s.chunks.push(e.data); };
  s.recorder.start();
  setStatus('hearing');
}

/** Stop recording, and hand back what was recorded. */
function stopRecording(s) {
  const recorder = s.recorder;
  s.recorder = null;
  if (!recorder || recorder.state === 'inactive') return Promise.resolve([]);
  return new Promise((resolve) => {
    recorder.onstop = () => resolve(s.chunks);
    recorder.stop();
  });
}

async function send(target, text) {
  if (target.kind === 'meeting') {
    const input = document.getElementById('meeting-input');
    if (!input) return;
    input.value = text;
    document.getElementById('meeting-send-btn')?.click();
    return;
  }
  const threads = document.getElementById(target.panel);
  if (threads?.getAttribute('agent') === target.agent && threads.sendText?.(text)) return;
  // The chat moved on while this was being transcribed: send where it was said.
  await fetch('/api/cli', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ line: `@${target.agent} ${text}`, threadId: target.thread }),
  }).catch((err) => say(`Could not send what you said: ${err?.message ?? err}`));
}

async function finishUtterance(s, keep) {
  const target = s.target;
  const chunks = await stopRecording(s);
  if (!keep || !target || chunks.length === 0) { if (session === s) setStatus('listening'); return; }

  setStatus('transcribing');
  const heard = await transcribe(chunks);
  if (heard.error) {
    say(`${heard.error}. Listening has stopped.`);
    stopListening();
    return;
  }
  if (heard.text) await send(target, heard.text);
  if (session === s) setStatus('listening');
}

function tick(s) {
  const now = Date.now();
  s.level = level(s);
  s.loudest = Math.max(s.loudest, s.level);
  // A ring on the button shows what the microphone hears, live.
  button()?.style.setProperty('--listen-level', String(Math.min(1, s.level / s.threshold)));
  // Nothing at all from the microphone is a broken input, not a quiet room.
  if (!s.warned && now - s.startedAt > SILENT_MIC_MS && s.loudest === 0) {
    s.warned = true;
    say(`Listen mode is getting pure silence from the microphone (${s.ctx.state}). Check the browser is using the right microphone, and that it isn't muted.`);
  }

  // Deaf while an agent talks, unless already hearing the human.
  if (!s.recorder && (isSpeechPlaying() || status === 'transcribing')) { s.vad = QUIET; return; }

  // Learn the room's background noise while nobody is speaking.
  if (!s.vad.speaking) {
    s.floor = nextFloor(s.floor, s.level);
    s.threshold = thresholdFor(s.floor);
  }
  const step = vadStep(s.vad, s.level, now, { ...VAD, threshold: s.threshold });
  s.vad = step.at;
  if (step.event === 'start') {
    const target = listenTarget(page());
    if (target) startRecording(s, target);    // nothing open: nothing recorded
  } else if (step.event === 'end' || step.event === 'discard') {
    if (s.recorder) void finishUtterance(s, step.event === 'end');
  }
}

async function startListening() {
  // Made here, inside the click, before anything is awaited: an AudioContext
  // made later may start suspended, and a suspended one hears only silence.
  const ctx = new AudioContext();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (err) {
    void ctx.close().catch(() => {});
    say(`Microphone unavailable: ${err?.message ?? err}. Check the site's microphone permission.`);
    return;
  }
  await ctx.resume().catch(() => {});
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const s = {
    stream, ctx, analyser, samples: new Float32Array(analyser.fftSize), vad: QUIET, recorder: null, chunks: [], target: null,
    level: 0, loudest: 0, floor: 0, threshold: thresholdFor(0), startedAt: Date.now(), warned: false,
  };
  s.timer = setInterval(() => tick(s), TICK_MS);
  session = s;
  setStatus('listening');
}

export function stopListening() {
  const s = session;
  session = null;
  if (s) {
    clearInterval(s.timer);
    void stopRecording(s);
    s.stream.getTracks().forEach((t) => t.stop());
    void s.ctx.close().catch(() => {});
  }
  setStatus('off');
}

export function initListen() {
  const btn = button();
  if (!btn) return;
  const toggle = () => (session ? stopListening() : startListening());
  btn.addEventListener('click', toggle);
  meetingButton()?.addEventListener('click', toggle);
  // Keep the tooltip saying where speech goes as the page changes.
  setInterval(() => { if (status === 'listening') show(); }, 1000);
  show();
}
