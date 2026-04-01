// meeting.js — Human-included meeting overlay with multi-avatar display and speech queue
// Loaded as <script type="module">; exposes window.meetingUI for app.js.
// Three.js is loaded lazily so a CDN failure never prevents the overlay from working.

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

const BLEND = 0.18;
const BODY_KEYWORDS = ['torso', 'chest', 'body', 'shoulder', 'arm', 'hand',
                       'leg', 'foot', 'toe', 'hips', 'spine'];
const CANVAS_SIZE = 512; // draw-buffer size — CSS scales it via aspect-ratio/flex

// ── State ─────────────────────────────────────────────────────────────────────

let activeMeetingId = null;
let speechEnabled   = true;

// Server-provided voice/speaker assignments (set on open, cleared on close)
let agentVoiceMap   = {};
let agentSpeakerMap = {};

// Per-participant Three.js slot: name → { renderer, scene, camera, visemeMeshes, morphWeights, targetViseme }
const slots = {};

// Shared render loop
let rafId = null;

// Speech queue: [{ participant, content }]
const speechQueue    = [];
let   speechPlaying  = false;
let   audioCtx       = null;
let   currentSource  = null; // AudioBufferSourceNode

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

  return { renderer, scene, camera, visemeMeshes: [], morphWeights: {}, targetViseme: 'viseme_sil' };
}

function loadSlotGLB(slot, file, camPos, rotate) {
  if (!slot || !GLTFLoader) return;
  const toRemove = slot.scene.children.filter(c => !c.isLight);
  for (const c of toRemove) slot.scene.remove(c);
  slot.visemeMeshes = [];

  new GLTFLoader().load(`/avatars/${file}`, gltf => {
    slot.scene.add(gltf.scene);

    if (rotate && rotate.length === 3) {
      const DEG = Math.PI / 180;
      gltf.scene.rotation.set(rotate[0] * DEG, rotate[1] * DEG, rotate[2] * DEG);
    }

    slot.camera.position.set(camPos[0], camPos[1], camPos[2]);
    slot.camera.lookAt(new THREE.Vector3(camPos[0], camPos[1] - 0.08, 0));

    gltf.scene.traverse(obj => {
      if (!obj.isMesh) return;
      if (obj.morphTargetDictionary) {
        const hasViseme = Object.keys(obj.morphTargetDictionary).some(k => k.startsWith('viseme_'));
        if (hasViseme && !slot.visemeMeshes.includes(obj)) slot.visemeMeshes.push(obj);
      }
      const low = obj.name.toLowerCase();
      if (BODY_KEYWORDS.some(kw => low.includes(kw))) obj.visible = false;
    });
  });
}

function renderAllSlots() {
  rafId = requestAnimationFrame(renderAllSlots);

  for (const slot of Object.values(slots)) {
    // Lerp morph weights
    for (const key of Object.keys(slot.morphWeights)) {
      slot.morphWeights[key] *= (1 - BLEND);
      if (slot.morphWeights[key] < 0.001) delete slot.morphWeights[key];
    }
    if (slot.targetViseme) {
      const cur = slot.morphWeights[slot.targetViseme] ?? 0;
      slot.morphWeights[slot.targetViseme] = cur + BLEND * (1 - cur);
    }

    // Apply to meshes
    for (const mesh of slot.visemeMeshes) {
      const dict = mesh.morphTargetDictionary;
      const infl = mesh.morphTargetInfluences;
      if (!dict || !infl) continue;
      for (const key of Object.keys(dict)) {
        if (key.startsWith('viseme_')) infl[dict[key]] = slot.morphWeights[key] ?? 0;
      }
    }

    slot.renderer.render(slot.scene, slot.camera);
  }
}

// ── Speech helpers ────────────────────────────────────────────────────────────

function getAudioContext() {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

function stopCurrentAudio() {
  if (currentSource) {
    try { currentSource.stop(); } catch { /* already stopped */ }
    currentSource = null;
  }
}

function setSlotSpeaking(name, speaking) {
  const el = document.querySelector(`.meeting-avatar-slot[data-name="${name}"]`);
  if (el) el.classList.toggle('speaking', speaking);
}

function setSpeakingViseme(name, viseme) {
  if (slots[name]) slots[name].targetViseme = viseme;
}

async function playSpeechChunk(chunk, name) {
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

        // Drive lipsync: synthetic mouth-open oscillation (replaced by real visemes after start)
        const visemes = chunk.visemes ?? [];
        let flip = true;
        let lipsyncInterval = setInterval(() => {
          setSpeakingViseme(name, flip ? 'viseme_aa' : 'viseme_sil');
          flip = !flip;
        }, 160);

        const startTime = ctx.currentTime;
        source.onended = () => {
          clearInterval(lipsyncInterval);
          setSpeakingViseme(name, 'viseme_sil');
          currentSource = null;
          resolve();
        };

        if (visemes.length > 0) {
          // Replace the interval with a closure over startTime
          clearInterval(lipsyncInterval);
          lipsyncInterval = setInterval(() => {
            const t = ctx.currentTime - startTime;
            const cue = visemes.find(v => t >= v.start && t < v.end);
            setSpeakingViseme(name, cue ? cue.viseme : 'viseme_sil');
          }, 16);
        }

        source.start();
      }, () => resolve()); // decode error — skip
    } catch { resolve(); }
  });
}

async function drainSpeechQueue() {
  if (speechPlaying) return;
  speechPlaying = true;

  while (speechQueue.length > 0) {
    const entry = speechQueue.shift();
    if (!activeMeetingId) break;

    const { participant, content } = entry;
    if (participant === 'human') { continue; } // no TTS for human

    if (!speechEnabled) {
      continue; // skip audio but keep processing
    }

    // Look up voice for this agent — prefer server config, fall back to localStorage
    const voiceId   = agentVoiceMap[participant]
      ?? (() => { try { return JSON.parse(localStorage.getItem('agentVoices') || '{}')[participant] ?? null; } catch { return null; } })();
    const speakerName = agentSpeakerMap[participant]
      ?? (() => { try { return JSON.parse(localStorage.getItem('agentSpeakers') || '{}')[participant] ?? null; } catch { return null; } })();

    setSlotSpeaking(participant, true);

    try {
      const resp = await fetch('/api/speech/synthesise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: content, voice: voiceId, speakerName }),
      });

      if (resp.ok) {
        const { chunks } = await resp.json();
        for (const chunk of (chunks ?? [])) {
          if (!activeMeetingId) break;
          await playSpeechChunk(chunk, participant);
        }
      }
    } catch { /* speech failed — continue silently */ }

    setSlotSpeaking(participant, false);
    setSpeakingViseme(participant, 'viseme_sil');
  }

  speechPlaying = false;
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function appendTranscriptTurn(participant, content) {
  const el = document.getElementById('meeting-transcript');
  if (!el) return;

  const turn = document.createElement('div');
  turn.className = 'meeting-turn';

  const speaker = document.createElement('div');
  speaker.className = 'meeting-turn-speaker' + (participant === 'human' ? ' human' : '');
  speaker.textContent = participant === 'human' ? 'You' : participant;

  const text = document.createElement('div');
  text.className = 'meeting-turn-content';
  text.textContent = content;

  turn.appendChild(speaker);
  turn.appendChild(text);
  el.appendChild(turn);
  el.scrollTop = el.scrollHeight;
}

// ── Public API ────────────────────────────────────────────────────────────────

window.meetingUI = {

  async open(meetingId, topic, participants, facilitator, serverAvatars = {}, serverVoices = {}, serverSpeakers = {}) {
    activeMeetingId = meetingId;
    agentVoiceMap   = serverVoices;
    agentSpeakerMap = serverSpeakers;

    // Reset UI
    document.getElementById('meeting-title').textContent = `Meeting: ${topic}`;
    document.getElementById('meeting-transcript').innerHTML = '';
    document.getElementById('meeting-human-input').hidden = false;
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

    // Build participant list (facilitator first, then others)
    const all = [facilitator, ...participants.filter(p => p !== facilitator)];

    // Build avatar slots
    const avatarOverrides = (() => {
      try { return JSON.parse(localStorage.getItem('agentAvatars') || '{}'); } catch { return {}; }
    })();

    const container = document.getElementById('meeting-avatars');

    for (const name of all) {
      const slotEl = document.createElement('div');
      slotEl.className = 'meeting-avatar-slot';
      slotEl.dataset.name = name;

      if (name === 'human') {
        const icon = document.createElement('div');
        icon.className = 'meeting-avatar-human';
        icon.textContent = '🧑';
        slotEl.appendChild(icon);
      } else if (hasThree) {
        const canvas = document.createElement('canvas');
        canvas.className = 'meeting-avatar-canvas';
        canvas.width  = CANVAS_SIZE;
        canvas.height = CANVAS_SIZE;
        slotEl.appendChild(canvas);

        // Init Three.js slot
        const slot = createSlotRenderer(canvas);
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
        if (av) loadSlotGLB(slot, av.file, av.camera, av.rotate);
      } else {
        // Fallback: coloured initials circle when Three.js is unavailable
        const icon = document.createElement('div');
        icon.className = 'meeting-avatar-human';
        icon.textContent = name.slice(0, 2).toUpperCase();
        slotEl.appendChild(icon);
      }

      const label = document.createElement('div');
      label.className = 'meeting-avatar-name';
      label.textContent = name === 'human' ? 'You' : name;
      slotEl.appendChild(label);

      container.appendChild(slotEl);
    }

    // Start render loop (only if Three.js slots were created)
    if (hasThree && !rafId && Object.keys(slots).length > 0) renderAllSlots();
  },

  addTurn(participant, content) {
    if (!activeMeetingId) return;
    appendTranscriptTurn(participant, content);
    if (participant !== 'human') {
      speechQueue.push({ participant, content });
      drainSpeechQueue();
    }
  },

  requestHumanTurn(meetingId) {
    if (meetingId !== activeMeetingId) return;
    document.getElementById('meeting-turn-label').hidden = false;
    document.getElementById('meeting-pass-btn').hidden = false;
    document.getElementById('meeting-input')?.focus();
  },

  close(meetingId) {
    if (meetingId && meetingId !== activeMeetingId) return;
    activeMeetingId = null;
    agentVoiceMap   = {};
    agentSpeakerMap = {};
    stopCurrentAudio();
    speechQueue.length = 0;
    speechPlaying = false;

    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }

    // Dispose Three.js renderers
    for (const slot of Object.values(slots)) {
      slot.renderer.dispose();
    }
    for (const key of Object.keys(slots)) delete slots[key];

    document.getElementById('meeting-overlay').hidden = true;
    document.getElementById('meeting-transcript').innerHTML = '';
    document.getElementById('meeting-human-input').hidden = true;
    document.getElementById('meeting-turn-label').hidden = true;
    document.getElementById('meeting-pass-btn').hidden = true;
  },

  setSpeechEnabled(enabled) {
    speechEnabled = enabled;
    const btn = document.getElementById('meeting-speech-toggle');
    if (btn) btn.classList.toggle('active', enabled);
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
    try {
      await fetch(`/api/meetings/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
    } catch { /* ignore — overlay will close when meeting_closed SSE arrives */ }
    // Close the overlay immediately from the user's side
    window.meetingUI.close(id);
  });

  document.getElementById('meeting-minimize-btn')?.addEventListener('click', () => {
    // Just hide the overlay without closing the meeting
    document.getElementById('meeting-overlay').hidden = true;
  });

  async function submitHumanTurn(pass = false) {
    if (!activeMeetingId) return;
    const inputEl = document.getElementById('meeting-input');
    const content = pass ? '' : (inputEl?.value.trim() ?? '');
    inputEl && (inputEl.value = '');
    document.getElementById('meeting-turn-label').hidden = true;
    document.getElementById('meeting-pass-btn').hidden = true;

    if (!pass && content) appendTranscriptTurn('human', content);

    try {
      await fetch(`/api/meetings/${encodeURIComponent(activeMeetingId)}/human-turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
    } catch { /* ignore */ }
  }

  document.getElementById('meeting-send-btn')?.addEventListener('click', () => submitHumanTurn(false));
  document.getElementById('meeting-pass-btn')?.addEventListener('click', () => submitHumanTurn(true));
  document.getElementById('meeting-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') submitHumanTurn(false);
  });

});
