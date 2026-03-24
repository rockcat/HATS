// avatar.js — Three.js GLB avatar renderer with procedural lipsync
// Loaded as <script type="module">; exposes window.avatarAPI for app.js.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ── Lipsync ──────────────────────────────────────────────────────────────────

const MS_PER_CHAR = 65;

const CHAR_VISEME = {
  a: 'viseme_aa', e: 'viseme_E', i: 'viseme_I', o: 'viseme_O', u: 'viseme_U',
  m: 'viseme_PP', b: 'viseme_PP', p: 'viseme_PP',
  f: 'viseme_FF', v: 'viseme_FF',
  d: 'viseme_DD', t: 'viseme_DD',
  k: 'viseme_kk', g: 'viseme_kk',
  s: 'viseme_SS', z: 'viseme_SS',
  n: 'viseme_nn',
  r: 'viseme_RR',
  ' ': 'viseme_sil', ',': 'viseme_sil', '.': 'viseme_sil', '!': 'viseme_sil', '?': 'viseme_sil',
};

let targetViseme = 'viseme_sil';
const morphWeights = {};
let pendingTimeouts = [];

// Speech-aligned lipsync (overrides procedural when active)
let speechVisemes  = null;  // VisemeEvent[] | null
let getAudioTime   = null;  // () => number | null

function scheduleVisemes(text) {
  for (const t of pendingTimeouts) clearTimeout(t);
  pendingTimeouts = [];
  targetViseme = 'viseme_sil';

  let delay = 50;
  for (const ch of text) {
    const v = CHAR_VISEME[ch.toLowerCase()] ?? null;
    if (v) {
      const vis = v;
      pendingTimeouts.push(setTimeout(() => { targetViseme = vis; }, delay));
    }
    delay += MS_PER_CHAR;
  }
  // Return to silence at the end
  pendingTimeouts.push(setTimeout(() => { targetViseme = 'viseme_sil'; }, delay + 200));
}

// ── Three.js ─────────────────────────────────────────────────────────────────

let renderer = null;
let scene    = null;
let camera   = null;
let rafId    = null;
let visemeMeshes = [];

const BLEND = 0.18; // lerp speed per frame (higher = snappier transitions)

const BODY_KEYWORDS = ['torso', 'chest', 'body', 'shoulder', 'arm', 'hand',
                       'leg', 'foot', 'toe', 'hips', 'spine'];

function initRenderer(canvas) {
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);

  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(1, 2, 2);
  scene.add(dir);
  const fill = new THREE.DirectionalLight(0xffffff, 0.3);
  fill.position.set(-1, 0, 1);
  scene.add(fill);
}

function resizeRenderer(canvas) {
  const w = canvas.clientWidth  || 320;
  const h = canvas.clientHeight || 240;
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function loadGLB(file, camPos) {
  // Remove old avatar nodes (keep lights)
  const toRemove = scene.children.filter(c => !c.isLight);
  for (const c of toRemove) scene.remove(c);
  visemeMeshes = [];

  new GLTFLoader().load(`/avatars/${file}`, gltf => {
    scene.add(gltf.scene);

    camera.position.set(camPos[0], camPos[1], camPos[2]);

    gltf.scene.traverse(obj => {
      if (!obj.isMesh) return;

      // Collect morph-target meshes that have viseme targets
      if (obj.morphTargetDictionary) {
        const hasViseme = Object.keys(obj.morphTargetDictionary).some(k => k.startsWith('viseme_'));
        if (hasViseme && !visemeMeshes.includes(obj)) visemeMeshes.push(obj);
      }

      // Hide body parts — only the head/face should be visible
      const low = obj.name.toLowerCase();
      if (BODY_KEYWORDS.some(kw => low.includes(kw))) obj.visible = false;
    });

    // Point camera toward where the face should be (slightly below the camera y)
    camera.lookAt(new THREE.Vector3(camPos[0], camPos[1] - 0.08, 0));
  });
}

function renderLoop() {
  rafId = requestAnimationFrame(renderLoop);

  // Determine target viseme: prefer time-aligned speech data over procedural
  if (speechVisemes && getAudioTime) {
    const t = getAudioTime();
    const cue = speechVisemes.find(v => t >= v.start && t < v.end);
    targetViseme = cue ? cue.viseme : 'viseme_sil';
  }

  // Lerp morph weights toward target
  for (const key of Object.keys(morphWeights)) {
    morphWeights[key] *= (1 - BLEND);
    if (morphWeights[key] < 0.001) delete morphWeights[key];
  }
  if (targetViseme) {
    const cur = morphWeights[targetViseme] ?? 0;
    morphWeights[targetViseme] = cur + BLEND * (1 - cur);
  }

  // Write weights into every viseme-capable mesh
  for (const mesh of visemeMeshes) {
    const dict = mesh.morphTargetDictionary;
    const infl = mesh.morphTargetInfluences;
    if (!dict || !infl) continue;
    for (const key of Object.keys(dict)) {
      if (key.startsWith('viseme_')) infl[dict[key]] = morphWeights[key] ?? 0;
    }
  }

  renderer.render(scene, camera);
}

// ── Public API ───────────────────────────────────────────────────────────────

window.avatarAPI = {
  /**
   * Show avatar for the given GLB file.
   * @param {string} avatarFile  - filename, e.g. "casey.glb"
   * @param {[number,number,number]} cameraPos - [x, y, z] camera position
   */
  show(avatarFile, cameraPos) {
    const panel  = document.getElementById('avatar-panel');
    const canvas = document.getElementById('avatar-canvas');
    if (!panel || !canvas) return;

    panel.hidden = false;

    if (!renderer) initRenderer(canvas);
    resizeRenderer(canvas);
    loadGLB(avatarFile, cameraPos);

    if (!rafId) renderLoop();
  },

  /**
   * Animate lip-sync for the given text string (no audio required — procedural fallback).
   * If speech-aligned data is active this is a no-op.
   * @param {string} text
   */
  speak(text) {
    if (!text || visemeMeshes.length === 0 || speechVisemes) return;
    scheduleVisemes(text);
  },

  /**
   * Begin audio-aligned lipsync.
   * @param {Array<{viseme:string, start:number, end:number}>} visemes
   * @param {() => number} timeGetter  Returns current audio playback time in seconds.
   */
  beginSpeech(visemes, timeGetter) {
    // Cancel any pending procedural timeouts
    for (const t of pendingTimeouts) clearTimeout(t);
    pendingTimeouts = [];
    speechVisemes = visemes;
    getAudioTime  = timeGetter;
  },

  /** Stop audio-aligned lipsync and return to silence. */
  endSpeech() {
    speechVisemes = null;
    getAudioTime  = null;
    targetViseme  = 'viseme_sil';
  },

  /** Hide the avatar panel and stop rendering. */
  hide() {
    for (const t of pendingTimeouts) clearTimeout(t);
    pendingTimeouts = [];
    speechVisemes = null;
    getAudioTime  = null;
    targetViseme  = 'viseme_sil';

    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    visemeMeshes = [];

    const panel = document.getElementById('avatar-panel');
    if (panel) panel.hidden = true;
  },
};
