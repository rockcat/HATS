// meeting.js — Human-included meeting overlay with multi-avatar display and speech queue
// Loaded as <script type="module">; exposes window.meetingUI for app.js.
// Three.js is loaded lazily so a CDN failure never prevents the overlay from working.

import { collectVisemeMeshes, stepMorphWeights, applyMorphWeights } from './morph-lipsync.js';

// Lazily resolved Three.js handles — null until first meeting opens
let THREE = null;
let GLTFLoader = null;

async function ensureThree() {
  if (THREE) return true;
  try {
    const [threeModule, gltfModule] = await Promise.all([
      import('three'),
      import('three/addons/loaders/GLTFLoader.js'),
    ]);
    THREE = threeModule;
    GLTFLoader = gltfModule.GLTFLoader;
    return true;
  } catch {
    return false; // Three.js unavailable — avatars degrade gracefully
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CANVAS_SIZE = 512; // draw-buffer size — CSS scales it via aspect-ratio/flex

// ── State ─────────────────────────────────────────────────────────────────────

let activeMeetingId = null;
let speechEnabled   = true;

// Server-provided voice/speaker assignments (set on open, cleared on close)
let agentVoiceMap   = {};
let agentSpeakerMap = {};

// Per-participant Three.js slot: name → { renderer, scene, camera, visemeMeshes, morphWeights, targetViseme }
const slots = {};

// Raised hands
const raisedHands = new Set();

// Shared render loop
let rafId = null;

// Speech queue: [{ participant, content }]
const speechQueue    = [];
let   speechPlaying  = false;
let   audioCtx       = null;
let   currentSource  = null; // AudioBufferSourceNode

// Module-level prefetch so addTurn can start synthesis while audio is still playing
let   prefetch        = null; // { participant, content, promise } | null

// Hat colours (mirrors HAT in app.js)
const HAT_COLORS = {
  white:  '#e6edf3',
  red:    '#f85149',
  black:  '#8b949e',
  yellow: '#e3b341',
  green:  '#3fb950',
  blue:   '#58a6ff',
};

// Deferred callbacks that run once the speech queue fully drains
let   onQueueDrained  = null; // single pending callback
let   meetingClosing  = false; // true after meeting_closed — blocks new turns, lets queue drain

// Avatar catalogue (from /api/avatars)
let avatarCatalogue = [];

// ── Three.js helpers ──────────────────────────────────────────────────────────

function createSlotRenderer(canvas) {
  if (!THREE) return null;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(CANVAS_SIZE, CANVAS_SIZE, false);

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(1, 2, 2); scene.add(dir);
  const fill = new THREE.DirectionalLight(0xffffff, 0.3);
  fill.position.set(-1, 0, 1); scene.add(fill);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  const clock  = new THREE.Clock();

  let resolveLoaded;
  const glbLoaded = new Promise(res => { resolveLoaded = res; });
  return { renderer, scene, camera, clock, mixer: null, visemeMeshes: [], morphWeights: {}, targetViseme: 'viseme_sil', glbLoaded, _resolveLoaded: resolveLoaded };
}

function loadSlotGLB(slot, file, camPos, rotate, fov, scale) {
  if (!slot || !GLTFLoader) return;
  const toRemove = slot.scene.children.filter(c => !c.isLight);
  for (const c of toRemove) slot.scene.remove(c);
  slot.visemeMeshes = [];
  if (slot.mixer) { slot.mixer.stopAllAction(); slot.mixer = null; }
  slot.clock.getDelta(); // reset clock delta
  if (slot.loadGen == null) slot.loadGen = 0;
  const gen = ++slot.loadGen;

  // Create a new glbLoaded promise for this load
  let resolveLoaded;
  slot.glbLoaded = new Promise(res => { resolveLoaded = res; });
  slot._resolveLoaded = resolveLoaded;

  new GLTFLoader().load(`/avatars/${file}`, gltf => {
    if (gen !== slot.loadGen) { resolveLoaded(); return; } // stale load — discard
    slot.scene.add(gltf.scene);

    if (rotate && rotate.length === 3) {
      const DEG = Math.PI / 180;
      gltf.scene.rotation.set(rotate[0] * DEG, rotate[1] * DEG, rotate[2] * DEG);
    }

    if (scale != null) gltf.scene.scale.setScalar(scale);

    slot.camera.fov = fov ?? 50;
    slot.camera.updateProjectionMatrix();
    slot.camera.position.set(camPos[0], camPos[1], camPos[2]);
    slot.camera.lookAt(new THREE.Vector3(camPos[0], camPos[1] - 0.08, 0));

    slot.visemeMeshes = collectVisemeMeshes(gltf.scene);
    // Start idle animations if the GLB has any
    if (gltf.animations?.length > 0) {
      slot.mixer = new THREE.AnimationMixer(gltf.scene);
      for (const clip of gltf.animations) {
        slot.mixer.clipAction(clip).play();
      }
    }

    resolveLoaded();
  }, undefined, () => resolveLoaded()); // error → resolve anyway so speech isn't blocked
}

function renderAllSlots() {
  rafId = requestAnimationFrame(renderAllSlots);

  for (const slot of Object.values(slots)) {
    const delta = slot.clock.getDelta();

    // Advance idle animations (runs before viseme writes so lipsync overrides mouth tracks)
    if (slot.mixer) slot.mixer.update(delta);

    // Resolve target viseme from audio-aligned speech state (same approach as avatar.js)
    if (slot.speechCtx) {
      const t = Math.max(0, slot.speechCtx.currentTime - slot.speechStartAt);
      const withinAudio = t < (slot.speechDuration ?? 0);
      if (slot.speechVisemes) {
        // Real Rhubarb viseme data — find the cue at time t
        const cue = slot.speechVisemes.find(v => t >= v.start && t < v.end);
        if (cue) {
          slot.targetViseme = cue.viseme;
        } else if (withinAudio) {
          // t is within audio but no cue matched — gap in Rhubarb data or timing
          // drift; fall back to synthetic oscillation so lips keep moving
          slot.targetViseme = Math.floor(t / 0.18) % 2 === 0 ? 'viseme_aa' : 'viseme_sil';
        } else {
          slot.targetViseme = 'viseme_sil';
        }
      } else {
        // No viseme data — synthetic oscillation for entire audio duration
        slot.targetViseme = withinAudio
          ? (Math.floor(t / 0.18) % 2 === 0 ? 'viseme_aa' : 'viseme_sil')
          : 'viseme_sil';
      }
    }

    // Lerp morph weights toward target, then write to meshes
    stepMorphWeights(slot.morphWeights, slot.targetViseme);
    applyMorphWeights(slot.visemeMeshes, slot.morphWeights);

    slot.renderer.render(slot.scene, slot.camera);
  }
}

// ── Speech helpers ────────────────────────────────────────────────────────────

function getAudioContext() {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function stopCurrentAudio() {
  if (currentSource) {
    try { currentSource.stop(); } catch { /* already stopped */ }
    currentSource = null;
  }
}

function setHandRaised(name, raised) {
  if (raised) {
    raisedHands.add(name);
  } else {
    raisedHands.delete(name);
  }
  const slotEl = document.querySelector(`.meeting-avatar-slot[data-name="${name}"]`);
  if (!slotEl) return;
  // Append badge inside the frame/human div so it's clipped correctly and positioned relative to the avatar
  const frameEl = slotEl.querySelector('.meeting-avatar-frame, .meeting-avatar-human') ?? slotEl;
  let badge = slotEl.querySelector('.meeting-hand-badge');
  if (raised && !badge) {
    badge = document.createElement('span');
    badge.className = 'meeting-hand-badge';
    badge.innerHTML = '<img src="/assets/raisedhand.svg" alt="">';
    frameEl.appendChild(badge);
  } else if (!raised && badge) {
    badge.remove();
  }
  // Sync raise-hand button state if this is the human
  if (name === 'human') {
    const btn = document.getElementById('meeting-raise-hand-btn');
    if (btn) {
      btn.classList.toggle('raised', raised);
      btn.innerHTML = raised ? '<img src="/assets/raisedhand.svg" class="svg-icon" alt=""> Lower Hand' : '<img src="/assets/raisedhand.svg" class="svg-icon" alt=""> Raise Hand';
    }
  }
}

function setSlotSpeaking(name, speaking) {
  const el = document.querySelector(`.meeting-avatar-slot[data-name="${name}"]`);
  if (el) el.classList.toggle('speaking', speaking);
  // Lower hand when a participant starts speaking
  if (speaking && raisedHands.has(name)) setHandRaised(name, false);
}

function setSpeakingViseme(name, viseme) {
  if (slots[name]) slots[name].targetViseme = viseme;
}

async function playSpeechChunk(chunk, name) {
  // Wait for the avatar GLB to finish loading (up to 4 s) so lipsync starts in sync
  if (slots[name]?.glbLoaded) {
    await Promise.race([slots[name].glbLoaded, new Promise(r => setTimeout(r, 4000))]);
  }

  return new Promise(resolve => {
    try {
      const ctx = getAudioContext();
      const raw = atob(chunk.audioBase64);
      const buf = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);

      ctx.decodeAudioData(buf.buffer, decoded => {
        const source = ctx.createBufferSource();
        source.buffer = decoded;
        source.connect(ctx.destination);
        currentSource = source;

        // Schedule start explicitly so lipsync base time is deterministic
        const startAt = ctx.currentTime;
        source.start(startAt);

        // Store speech state on the slot so renderAllSlots drives visemes via RAF
        const visemes = chunk.visemes ?? [];
        const audioDuration = decoded.duration;
        // Shift viseme clock back by output latency so lips match what is *heard*
        // rather than when audio is scheduled into the processing pipeline
        const latency = (ctx.outputLatency ?? 0) + (ctx.baseLatency ?? 0);
        console.log(`[Meeting Lipsync] ${name}: ${visemes.length} visemes, audio=${audioDuration.toFixed(2)}s, latency=${latency.toFixed(3)}s, slot=${!!slots[name]}, meshes=${slots[name]?.visemeMeshes?.length ?? 0}`);
        if (slots[name]) {
          slots[name].speechVisemes    = visemes.length > 0 ? visemes : null;
          slots[name].speechStartAt    = startAt + latency;
          slots[name].speechCtx        = ctx;
          slots[name].speechDuration   = audioDuration;
        }

        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(safetyTimer);
          if (slots[name]) {
            slots[name].speechVisemes  = null;
            slots[name].speechStartAt  = null;
            slots[name].speechCtx     = null;
            slots[name].speechDuration = null;
          }
          setSpeakingViseme(name, 'viseme_sil');
          if (currentSource === source) currentSource = null;
          resolve();
        };
        source.onended = finish;
        const safetyTimer = setTimeout(finish, (audioDuration + 1.5) * 1000);
      }, () => resolve()); // decode error — skip
    } catch { resolve(); }
  });
}

function getVoiceParams(participant) {
  const voiceId = agentVoiceMap[participant]
    ?? (() => { try { return JSON.parse(localStorage.getItem('agentVoices') || '{}')[participant] ?? null; } catch { return null; } })();
  const speakerName = agentSpeakerMap[participant]
    ?? (() => { try { return JSON.parse(localStorage.getItem('agentSpeakers') || '{}')[participant] ?? null; } catch { return null; } })();
  return { voiceId, speakerName };
}

/**
 * Starts a streaming TTS request and buffers chunks as they arrive.
 * Implements async iteration so the consumer plays each sentence as soon
 * as it is synthesised rather than waiting for the full turn.
 */
class SpeechStream {
  constructor(participant, content) {
    this.participant = participant;
    this.content     = content;
    this._buffer     = [];
    this._done       = false;
    this._waiters    = [];
    this._start();
  }

  _notify() {
    const ws = this._waiters; this._waiters = [];
    ws.forEach(r => r());
  }

  async _start() {
    const { voiceId, speakerName } = getVoiceParams(this.participant);
    try {
      const resp = await fetch('/api/speech/synthesise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: this.content, voice: voiceId, speakerName }),
      });
      if (!resp.ok || !resp.body) {
        console.warn(`[SpeechStream] ${this.participant}: HTTP ${resp.status}`);
        return;
      }
      const reader  = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop(); // keep incomplete trailing line
        for (const line of lines) {
          if (!line.trim()) continue;
          try { this._buffer.push(JSON.parse(line)); this._notify(); } catch { /* skip bad line */ }
        }
      }
      if (buf.trim()) {
        try { this._buffer.push(JSON.parse(buf)); this._notify(); } catch {}
      }
    } catch (err) {
      console.error(`[SpeechStream] ${this.participant}: fetch threw`, err);
    } finally {
      this._done = true;
      this._notify();
    }
  }

  async *[Symbol.asyncIterator]() {
    let idx = 0;
    while (true) {
      if (idx < this._buffer.length) { yield this._buffer[idx++]; }
      else if (this._done)           { return; }
      else                           { await new Promise(r => this._waiters.push(r)); }
    }
  }
}

/** Notify the server that this turn's speech has finished — it can now generate the next turn. */
function ackTurn(participant) {
  if (!activeMeetingId || participant === 'human') return;
  fetch(`/api/meetings/${encodeURIComponent(activeMeetingId)}/turn-ack`, { method: 'POST' }).catch(() => {});
}

async function drainSpeechQueue() {
  if (speechPlaying) return;
  speechPlaying = true;

  while (speechQueue.length > 0) {
    const entry = speechQueue.shift();
    if (!activeMeetingId) break;

    const { participant, content } = entry;

    if (participant === 'human') {
      // Human turns have no audio; kick off prefetch for next agent turn
      if (speechEnabled && speechQueue.length > 0 && speechQueue[0].participant !== 'human') {
        const next = speechQueue[0];
        if (!prefetch || prefetch.participant !== next.participant || prefetch.content !== next.content) {
          prefetch = { participant: next.participant, content: next.content, stream: new SpeechStream(next.participant, next.content) };
        }
      }
      continue;
    }

    appendTranscriptTurn(participant, content);

    if (!speechEnabled) {
      ackTurn(participant); // no audio — ACK immediately so server can proceed
      continue;
    }

    setSlotSpeaking(participant, true);

    try {
      // Use pre-fetched stream if it matches, otherwise start a new one
      let stream;
      if (prefetch && prefetch.participant === participant && prefetch.content === content) {
        stream  = prefetch.stream;
        prefetch = null;
      } else {
        stream = new SpeechStream(participant, content);
      }

      // Kick off synthesis for the next queue entry in parallel while this one plays.
      // If the queue is currently empty, addTurn will start it when the next SSE arrives.
      if (speechQueue.length > 0 && speechQueue[0].participant !== 'human') {
        const next = speechQueue[0];
        if (!prefetch || prefetch.participant !== next.participant || prefetch.content !== next.content) {
          prefetch = { participant: next.participant, content: next.content, stream: new SpeechStream(next.participant, next.content) };
        }
      }

      // Play each sentence as soon as it streams in — no waiting for the full turn
      for await (const chunk of stream) {
        if (!activeMeetingId) break;
        await playSpeechChunk(chunk, participant);
      }
    } catch { /* speech failed — continue silently */ }

    setSlotSpeaking(participant, false);
    setSpeakingViseme(participant, 'viseme_sil');
    ackTurn(participant); // speech finished — server can generate the next turn
  }

  speechPlaying = false;

  // Fire any deferred action (human turn prompt or meeting close) now that the queue is empty
  if (onQueueDrained) {
    const cb = onQueueDrained;
    onQueueDrained = null;
    cb();
  }
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function appendTranscriptTurn(participant, content) {
  const el = document.getElementById('meeting-transcript');
  if (!el) return;

  const turn = document.createElement('div');
  turn.className = 'meeting-turn';

  const speaker = document.createElement('div');
  speaker.className = 'meeting-turn-speaker' + (participant === 'human' ? ' human' : '');
  speaker.textContent = participant === 'human' ? (window._meetingHumanName ?? 'human') : participant;

  const text = document.createElement('div');
  text.className = 'meeting-turn-content';
  text.textContent = content;

  turn.appendChild(speaker);
  turn.appendChild(text);
  el.appendChild(turn);
  el.scrollTop = el.scrollHeight;
}

// ── Layout: fill stage with largest possible square slots ─────────────────────

let _layoutResizeObs = null;

function getBestGrid(n, W, H) {
  const aspect = W / H;
  const estRows = Math.sqrt(n / aspect);
  let best = null;
  for (let rows = Math.floor(estRows) - 2; rows <= Math.ceil(estRows) + 2; rows++) {
    if (rows < 1) continue;
    const cols = Math.ceil(n / rows);
    const size = Math.min(W / cols, H / rows);
    if (!best || size > best.size) best = { rows, cols, size };
  }
  return best;
}

function layoutMeetingAvatars() {
  const container = document.getElementById('meeting-avatars');
  const stage     = document.getElementById('meeting-stage');
  if (!container || !stage) return;

  const slots = Array.from(container.children);
  const n = slots.length;
  if (n === 0) return;

  const W = stage.clientWidth;
  const H = stage.clientHeight;
  const { cols } = getBestGrid(n, W, H);

  slots.forEach(slot => {
    slot.style.width = `${100 / cols}%`;
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

window.meetingUI = {

  async open(meetingId, topic, participants, facilitator, serverAvatars = {}, serverVoices = {}, serverSpeakers = {}, serverBackgrounds = {}, humanName = 'human', hatMap = {}) {
    console.log(`[Meeting] open() called: id=${meetingId}, topic="${topic}", participants=${JSON.stringify(participants)}, facilitator=${facilitator}`);
    try {
    window._meetingHumanName = humanName;
    activeMeetingId = meetingId;
    agentVoiceMap   = serverVoices;
    agentSpeakerMap = serverSpeakers;

    // Reset UI
    document.getElementById('meeting-title').textContent = `Meeting: ${topic}`;
    document.getElementById('meeting-transcript').innerHTML = '';
    const hasHuman = participants.includes('human');
    document.getElementById('meeting-human-input').hidden = !hasHuman;
    document.getElementById('meeting-turn-label').hidden = true;
    document.getElementById('meeting-pass-btn').hidden = true;
    document.getElementById('meeting-avatars').innerHTML = '';
    document.getElementById('meeting-overlay').hidden = false;

    // Update speech toggle button
    const btn = document.getElementById('meeting-speech-toggle');
    btn.classList.toggle('active', speechEnabled);

    // Try to load Three.js (non-blocking — avatars degrade gracefully if unavailable)
    const hasThree = await ensureThree();

    // Load avatar catalogue if Three.js loaded and we haven't yet
    if (hasThree && avatarCatalogue.length === 0) {
      try {
        const r = await fetch('/api/avatars');
        avatarCatalogue = (await r.json()).avatars ?? [];
      } catch { /* no avatars */ }
    }

    // Build participant list (facilitator first, then others, deduped)
    const all = [...new Set([facilitator, ...participants.filter(p => p !== facilitator)])];

    // Build avatar slots
    const avatarOverrides = (() => {
      try { return JSON.parse(localStorage.getItem('agentAvatars') || '{}'); } catch { return {}; }
    })();

    const container = document.getElementById('meeting-avatars');

    for (const name of all) {
      const slotEl = document.createElement('div');
      slotEl.className = 'meeting-avatar-slot';
      slotEl.dataset.name = name;

      const hatColor = name !== 'human' ? (HAT_COLORS[hatMap[name]] ?? HAT_COLORS.white) : null;

      if (name === 'human') {
        const icon = document.createElement('div');
        icon.className = 'meeting-avatar-human';
        icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="50%" height="50%" aria-hidden="true">
          <circle cx="50" cy="36" r="22" fill="currentColor" opacity="0.7"/>
          <ellipse cx="50" cy="95" rx="36" ry="26" fill="currentColor" opacity="0.7"/>
        </svg>`;
        slotEl.appendChild(icon);
      } else if (hasThree) {
        // Frame div — holds background image and clips canvas to rounded corners
        const frameEl = document.createElement('div');
        frameEl.className = 'meeting-avatar-frame';
        const bgFile = serverBackgrounds[name];
        if (bgFile) {
          frameEl.style.backgroundImage = `url('/backgrounds/${encodeURIComponent(bgFile)}')`;
        }
        slotEl.appendChild(frameEl);

        const canvas = document.createElement('canvas');
        canvas.className = 'meeting-avatar-canvas';
        canvas.width  = CANVAS_SIZE;
        canvas.height = CANVAS_SIZE;
        frameEl.appendChild(canvas);

        // Hat icon badge
        const hatEl = document.createElement('div');
        hatEl.className = 'meeting-hat-icon';
        hatEl.style.backgroundColor = hatColor;
        frameEl.appendChild(hatEl);

        // Init Three.js slot
        const slot = createSlotRenderer(canvas);
        slot.speechVisemes = null;
        slot.speechStartAt = null;
        slot.speechCtx     = null;
        slots[name] = slot;

        // Find avatar: server config → localStorage override → name match → hash fallback
        const avatarFile = serverAvatars[name] ?? avatarOverrides[name];
        let av;
        if (avatarFile) {
          av = avatarCatalogue.find(a => a.file === avatarFile);
        }
        if (!av) {
          av = avatarCatalogue.find(a => a.name.toLowerCase() === name.toLowerCase());
        }
        if (!av && avatarCatalogue.length > 0) {
          const hash = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) & 0xffff, 0);
          av = avatarCatalogue[hash % avatarCatalogue.length];
        }
        if (av) loadSlotGLB(slot, av.file, av.camera, av.rotate, av.fov, av.scale);
      } else {
        // Fallback: coloured initials box when Three.js is unavailable
        const icon = document.createElement('div');
        icon.className = 'meeting-avatar-human';
        icon.textContent = name.slice(0, 2).toUpperCase();

        // Hat icon badge
        const hatEl = document.createElement('div');
        hatEl.className = 'meeting-hat-icon';
        hatEl.style.backgroundColor = hatColor;
        icon.appendChild(hatEl);

        slotEl.appendChild(icon);
      }

      const label = document.createElement('div');
      label.className = 'meeting-avatar-name';
      label.textContent = name === 'human' ? (window._meetingHumanName ?? 'human') : name;
      slotEl.appendChild(label);

      // Click slot to toggle hand raised
      slotEl.addEventListener('click', () => {
        const participant = slotEl.dataset.name;
        const nowRaised = !raisedHands.has(participant);
        setHandRaised(participant, nowRaised);
        // Broadcast to server so other clients see it
        if (activeMeetingId) {
          fetch(`/api/meetings/${encodeURIComponent(activeMeetingId)}/raise-hand`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ participant, raised: nowRaised }),
          }).catch(() => {});
        }
      });

      container.appendChild(slotEl);
    }

    raisedHands.clear();

    // Layout slots to fill the stage
    layoutMeetingAvatars();

    // Re-layout on resize
    if (_layoutResizeObs) _layoutResizeObs.disconnect();
    _layoutResizeObs = new ResizeObserver(layoutMeetingAvatars);
    _layoutResizeObs.observe(document.getElementById('meeting-stage'));

    // Start render loop (only if Three.js slots were created)
    if (hasThree && !rafId && Object.keys(slots).length > 0) renderAllSlots();
    } catch (err) {
      console.error('[Meeting] open() failed:', err);
    }
  },

  addTurn(participant, content) {
    if (!activeMeetingId || meetingClosing) return;
    if (participant === 'human') {
      // Human turns are shown immediately by submitHumanTurn; server echo is ignored
      // to avoid double display.
      return;
    }
    // Start synthesis immediately if audio is already playing and no prefetch is running,
    // so the gap between speakers is eliminated even when turns arrive one at a time.
    if (speechEnabled && speechPlaying && (!prefetch || prefetch.participant !== participant || prefetch.content !== content)) {
      prefetch = { participant, content, stream: new SpeechStream(participant, content) };
    }
    // Queue the turn — transcript entry is added just before audio plays
    speechQueue.push({ participant, content });
    drainSpeechQueue();
  },

  requestHumanTurn(meetingId) {
    if (meetingId !== activeMeetingId) return;
    const show = () => {
      if (activeMeetingId !== meetingId) return; // meeting closed while waiting
      if (raisedHands.has('human')) setHandRaised('human', false);
      document.getElementById('meeting-turn-label').hidden = false;
      document.getElementById('meeting-pass-btn').hidden = false;
      document.getElementById('meeting-input')?.focus();
    };
    // Wait for all queued turns to be displayed/played before prompting the human
    if (speechPlaying || speechQueue.length > 0) {
      onQueueDrained = show;
    } else {
      show();
    }
  },

  close(meetingId, { force = false } = {}) {
    if (meetingId && meetingId !== activeMeetingId) return;
    const idToClose = activeMeetingId;

    const doClose = () => {
      if (activeMeetingId !== idToClose) return; // guard against double-close
      activeMeetingId = null;
      meetingClosing  = false;
      onQueueDrained  = null;
      prefetch        = null;
      agentVoiceMap   = {};
      agentSpeakerMap = {};
      stopCurrentAudio();
      speechQueue.length = 0;
      speechPlaying = false;

      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }

      // Stop resize observer
      if (_layoutResizeObs) { _layoutResizeObs.disconnect(); _layoutResizeObs = null; }

      // Dispose Three.js renderers and mixers
      for (const slot of Object.values(slots)) {
        if (slot.mixer) { slot.mixer.stopAllAction(); slot.mixer = null; }
        slot.renderer.dispose();
      }
      for (const key of Object.keys(slots)) delete slots[key];

      raisedHands.clear();
      document.getElementById('meeting-overlay').hidden = true;
      document.getElementById('meeting-transcript').innerHTML = '';
      document.getElementById('meeting-human-input').hidden = true;
      document.getElementById('meeting-turn-label').hidden = true;
      document.getElementById('meeting-pass-btn').hidden = true;
      const rhBtn = document.getElementById('meeting-raise-hand-btn');
      if (rhBtn) { rhBtn.classList.remove('raised'); rhBtn.innerHTML = '<img src="/assets/raisedhand.svg" class="svg-icon" alt=""> Raise Hand'; }
    };

    if (!force && (speechPlaying || speechQueue.length > 0)) {
      // Let the queue finish playing so the human sees/hears all turns before it closes
      meetingClosing = true;   // block new turns from being queued
      onQueueDrained = doClose;
    } else {
      doClose();
    }
  },

  setSpeechEnabled(enabled) {
    speechEnabled = enabled;
    const btn = document.getElementById('meeting-speech-toggle');
    if (btn) btn.classList.toggle('active', enabled);
  },

  setHandRaised(participant, raised) {
    setHandRaised(participant, raised);
  },
};

// ── Init event listeners ──────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {

  document.getElementById('meeting-speech-toggle')?.addEventListener('click', () => {
    window.meetingUI.setSpeechEnabled(!speechEnabled);
  });

  document.getElementById('meeting-end-btn')?.addEventListener('click', async () => {
    if (!activeMeetingId) return;
    const id = activeMeetingId;
    // Close immediately — don't wait for the speech queue to drain
    window.meetingUI.close(id, { force: true });
    try {
      await fetch(`/api/meetings/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
    } catch { /* ignore */ }
  });

  document.getElementById('meeting-minimize-btn')?.addEventListener('click', () => {
    document.getElementById('meeting-overlay').hidden = true;
  });

  document.getElementById('meeting-download-btn')?.addEventListener('click', () => {
    const turns = document.querySelectorAll('#meeting-transcript .meeting-turn');
    if (!turns.length) return;
    const topic = document.getElementById('meeting-title')?.textContent.replace(/^Meeting:\s*/i, '') ?? 'Meeting';
    const date  = new Date().toISOString().slice(0, 10);
    let md = `# ${topic}\n_${date}_\n\n`;
    turns.forEach(turn => {
      const speaker = turn.querySelector('.meeting-turn-speaker')?.textContent ?? '';
      const content = turn.querySelector('.meeting-turn-content')?.textContent ?? '';
      md += `**${speaker}**\n${content}\n\n`;
    });
    const blob = new Blob([md], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${topic.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${date}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  async function submitHumanTurn(pass = false) {
    if (!activeMeetingId) return;
    const inputEl = document.getElementById('meeting-input');
    const content = pass ? '' : (inputEl?.value.trim() ?? '');
    if (!pass && !content) return; // nothing to send
    inputEl && (inputEl.value = '');
    document.getElementById('meeting-turn-label').hidden = true;
    document.getElementById('meeting-pass-btn').hidden = true;
    // Lower hand when speaking
    if (raisedHands.has('human')) setHandRaised('human', false);

    const id = activeMeetingId;

    // Show immediately in transcript (server echo is suppressed in addTurn)
    if (!pass && content) appendTranscriptTurn('human', content);

    try {
      // Try to fulfil a pending scheduled turn first
      const res = await fetch(`/api/meetings/${encodeURIComponent(id)}/human-turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: pass ? '' : content }),
      });
      if (!pass && content && !res.ok) {
        // Not the human's scheduled turn — inject as an interjection instead so
        // agents hear it in their next prompt context
        await fetch(`/api/meetings/${encodeURIComponent(id)}/human-interject`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        }).catch(() => {});
      }
    } catch { /* ignore network errors */ }
  }

  document.getElementById('meeting-raise-hand-btn')?.addEventListener('click', () => {
    if (!activeMeetingId) return;
    const nowRaised = !raisedHands.has('human');
    setHandRaised('human', nowRaised);
    fetch(`/api/meetings/${encodeURIComponent(activeMeetingId)}/raise-hand`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participant: 'human', raised: nowRaised }),
    }).catch(() => {});
  });

  document.getElementById('meeting-send-btn')?.addEventListener('click', () => submitHumanTurn(false));
  document.getElementById('meeting-pass-btn')?.addEventListener('click', () => submitHumanTurn(true));
  document.getElementById('meeting-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') submitHumanTurn(false);
  });

});
