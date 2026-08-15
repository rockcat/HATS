// ── Voice management & speech / TTS ──────────────────────────────────────────
//
// Flow:
//   1. When agent detail opens, send { type:'set_speech_agent', name, voice } over WS
//   2. Server synthesises via Piper + Rhubarb and sends back speech_chunk messages
//   3. Browser decodes base64 WAV, plays via Web Audio API
//   4. Audio clock drives avatarAPI.beginSpeech(visemes, getTime) for sync lipsync

let cachedVoices = null;  // PiperVoice[] | null — loaded once

export async function getVoices() {
  if (cachedVoices) return cachedVoices;
  try {
    const res = await fetch('/api/voices');
    cachedVoices = await res.json();
  } catch { cachedVoices = []; }
  return cachedVoices;
}

export function getVoiceOverrides() {
  try { return JSON.parse(localStorage.getItem('agentVoices') || '{}'); } catch { return {}; }
}

export function setVoiceOverride(agentName, voiceName) {
  const m = getVoiceOverrides();
  if (voiceName) m[agentName] = voiceName; else delete m[agentName];
  localStorage.setItem('agentVoices', JSON.stringify(m));
}

export function getSpeakerOverrides() {
  try { return JSON.parse(localStorage.getItem('agentSpeakers') || '{}'); } catch { return {}; }
}

export function setSpeakerOverride(agentName, speakerId) {
  const m = getSpeakerOverrides();
  if (speakerId != null) m[agentName] = speakerId; else delete m[agentName];
  localStorage.setItem('agentSpeakers', JSON.stringify(m));
}

/** Return the voice name to use for an agent, falling back to first available. */
export function findVoiceForAgent(agentName, voices) {
  if (!voices || voices.length === 0) return null;
  const override = getVoiceOverrides()[agentName];
  if (override && voices.find(v => v.name === override)) return override;
  return voices[0].name;
}

// ── AudioContext (shared) ─────────────────────────────────────────────────────

let audioCtx = null;

/** Create (or resume) the AudioContext and return it. Call inside a user gesture. */
export function ensureAudioCtx() {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// ── Speech / TTS ──────────────────────────────────────────────────────────────

let speechWs         = null;
const speechQueues   = new Map(); // agentName → SpeechChunk[]
const speechPlaying  = new Set(); // agents currently draining
let currentSource    = null;      // active AudioBufferSourceNode (for stop)
export let speechMuted = false;

// Which agent's speech chunks to accept (set by agent-detail when opening).
let _activeSpeechTarget = null;

export function setActiveSpeechTarget(name) {
  _activeSpeechTarget = name;
}

export function getSpeechWs() {
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

export function setSpeechAgent(agentName, voiceName, speakerName) {
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

export function handleSpeechChunk(chunk) {
  if (chunk.agentName !== _activeSpeechTarget) return; // stale — ignore
  if (speechMuted) return;

  const q = speechQueues.get(chunk.agentName) ?? [];
  q.push(chunk);
  speechQueues.set(chunk.agentName, q);

  if (!speechPlaying.has(chunk.agentName)) drainSpeechQueue(chunk.agentName);
}

export async function drainSpeechQueue(agentName) {
  speechPlaying.add(agentName);
  while (true) {
    const q = speechQueues.get(agentName) ?? [];
    if (q.length === 0 || agentName !== _activeSpeechTarget || speechMuted) break;
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

export async function playSpeechChunk(chunk) {
  // Wait for avatar GLB to finish loading (up to 4 s) so lipsync starts in sync
  if (window.avatarAPI?.whenLoaded) {
    await Promise.race([window.avatarAPI.whenLoaded(), new Promise(r => setTimeout(r, 4000))]);
  }

  const ctx = ensureAudioCtx();

  // Decode base64 → ArrayBuffer
  const binary = atob(chunk.audioBase64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const audioBuffer = await ctx.decodeAudioData(bytes.buffer);
  const source      = ctx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(ctx.destination);
  currentSource = source;

  const startAt = ctx.currentTime;
  source.start(startAt);

  const latency = (ctx.outputLatency ?? 0) + (ctx.baseLatency ?? 0);

  console.log(`[Lipsync] Agent: ${chunk.visemes?.length ?? 0} visemes, audio=${audioBuffer.duration.toFixed(2)}s, last viseme end=${chunk.visemes?.at(-1)?.end?.toFixed(2) ?? 'none'}s, latency=${latency.toFixed(3)}s`);
  window.avatarAPI?.beginSpeech(chunk.visemes, () => ctx.currentTime - startAt - latency, audioBuffer.duration);

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
    const safetyTimer = setTimeout(finish, (audioBuffer.duration + 1.5) * 1000);
  });
}

export function stopSpeech(agentName) {
  speechQueues.delete(agentName);
  speechPlaying.delete(agentName);
  if (currentSource) {
    try { currentSource.stop(); } catch { /* already stopped */ }
    currentSource = null;
  }
  window.avatarAPI?.endSpeech();
}

export function stopAllSpeech() {
  if (currentSource) {
    try { currentSource.stop(); } catch { /* already stopped */ }
    currentSource = null;
  }
  speechQueues.clear();
  speechPlaying.clear();
  window.avatarAPI?.endSpeech();
}

export function toggleMute() {
  speechMuted = !speechMuted;
  const btn = document.getElementById('mute-btn');
  btn.textContent = speechMuted ? 'Unmute' : 'Mute';
  btn.classList.toggle('mute-btn--active', speechMuted);
  if (speechMuted) stopAllSpeech();
}

export function clearSpeechQueue(agentName) {
  speechQueues.delete(agentName);
}
