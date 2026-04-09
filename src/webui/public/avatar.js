// avatar.js — Three.js GLB avatar renderer with audio-aligned lipsync
// Loaded as <script type="module">; exposes window.avatarAPI for app.js.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { collectVisemeMeshes, stepMorphWeights, applyMorphWeights } from './morph-lipsync.js';

// ── Lipsync state ─────────────────────────────────────────────────────────────

let targetViseme = 'viseme_sil';
const morphWeights = {};

// Speech-aligned lipsync
let speechVisemes  = null;  // VisemeEvent[] | null
let getAudioTime   = null;  // () => number | null
let speechDuration = 0;     // seconds — decoded audio duration of current chunk

// ── Three.js ─────────────────────────────────────────────────────────────────

let renderer = null;
let scene    = null;
let camera   = null;
let rafId    = null;
let visemeMeshes = [];
let loadGen  = 0; // incremented each loadGLB call; stale async callbacks check this
let glbLoaded = Promise.resolve(); // resolves when current GLB finishes loading

// Idle animation
let mixer    = null; // THREE.AnimationMixer | null
let clock    = new THREE.Clock();

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

function loadGLB(file, camPos, rotate, fov, scale) {
  // Remove old avatar nodes (keep lights) and dispose old mixer
  const toRemove = scene.children.filter(c => !c.isLight);
  for (const c of toRemove) scene.remove(c);
  visemeMeshes = [];
  if (mixer) { mixer.stopAllAction(); mixer = null; }
  clock.getDelta(); // reset clock delta

  const gen = ++loadGen; // this callback is only valid if gen === loadGen when it fires
  let resolveLoaded;
  glbLoaded = new Promise(res => { resolveLoaded = res; });

  new GLTFLoader().load(`/avatars/${file}`, gltf => {
    if (gen !== loadGen) { resolveLoaded(); return; } // stale — a newer load started, discard this one
    scene.add(gltf.scene);

    if (rotate && rotate.length === 3) {
      const DEG = Math.PI / 180;
      gltf.scene.rotation.set(rotate[0] * DEG, rotate[1] * DEG, rotate[2] * DEG);
    }

    if (scale != null) gltf.scene.scale.setScalar(scale);

    camera.fov = fov ?? 50;
    camera.updateProjectionMatrix();
    camera.position.set(camPos[0], camPos[1], camPos[2]);
    camera.lookAt(new THREE.Vector3(camPos[0], camPos[1] - 0.08, 0));

    visemeMeshes = collectVisemeMeshes(gltf.scene);

    // Start idle animations if the GLB has any
    if (gltf.animations?.length > 0) {
      mixer = new THREE.AnimationMixer(gltf.scene);
      for (const clip of gltf.animations) {
        mixer.clipAction(clip).play();
      }
      console.log(`[Avatar] ${gltf.animations.length} idle animation(s) started`);
    }

    resolveLoaded();
  }, undefined, () => resolveLoaded()); // error → resolve anyway
}

function renderLoop() {
  rafId = requestAnimationFrame(renderLoop);

  const delta = clock.getDelta();

  // Advance idle animations
  if (mixer) mixer.update(delta);

  // Determine target viseme from time-aligned speech data
  if (getAudioTime) {
    const t = Math.max(0, getAudioTime());
    const withinAudio = t < speechDuration;
    if (speechVisemes && speechVisemes.length > 0) {
      const cue = speechVisemes.find(v => t >= v.start && t < v.end);
      if (cue) {
        targetViseme = cue.viseme;
      } else if (withinAudio) {
        targetViseme = Math.floor(t / 0.18) % 2 === 0 ? 'viseme_aa' : 'viseme_sil';
      } else {
        targetViseme = 'viseme_sil';
      }
    } else {
      targetViseme = withinAudio
        ? (Math.floor(t / 0.18) % 2 === 0 ? 'viseme_aa' : 'viseme_sil')
        : 'viseme_sil';
    }
  }

  // Lerp morph weights toward target, then write to meshes.
  // Runs after mixer.update() so lipsync overrides mouth tracks from idle animation.
  stepMorphWeights(morphWeights, targetViseme);
  applyMorphWeights(visemeMeshes, morphWeights);

  renderer.render(scene, camera);
}

// ── Public API ───────────────────────────────────────────────────────────────

window.avatarAPI = {
  /**
   * Show avatar for the given GLB file.
   * @param {string} avatarFile  - filename, e.g. "casey.glb"
   * @param {[number,number,number]} cameraPos - [x, y, z] camera position
   * @param {[number,number,number]} [rotate]  - [x, y, z] rotation in degrees (from avatars.json)
   */
  show(avatarFile, cameraPos, rotate, fov, scale, bgFile) {
    const panel  = document.getElementById('avatar-panel');
    const canvas = document.getElementById('avatar-canvas');
    if (!panel || !canvas) return;

    panel.hidden = false;
    panel.style.backgroundImage = bgFile
      ? `url('/backgrounds/${encodeURIComponent(bgFile)}')`
      : '';

    if (!renderer) initRenderer(canvas);
    resizeRenderer(canvas);
    loadGLB(avatarFile, cameraPos, rotate, fov, scale);

    if (!rafId) renderLoop();
  },

  /** Returns a Promise that resolves when the current GLB finishes loading. */
  whenLoaded() { return glbLoaded; },

  /**
   * Begin audio-aligned lipsync.
   * @param {Array<{viseme:string, start:number, end:number}>} visemes
   * @param {() => number} timeGetter  Returns current audio playback time in seconds.
   */
  beginSpeech(visemes, timeGetter, duration = 0) {
    speechVisemes  = visemes?.length > 0 ? visemes : null;
    getAudioTime   = timeGetter;
    speechDuration = duration;
  },

  /** Stop audio-aligned lipsync and return to silence. */
  endSpeech() {
    speechVisemes  = null;
    getAudioTime   = null;
    speechDuration = 0;
    targetViseme   = 'viseme_sil';
  },

  /** Hide the avatar panel and stop rendering. */
  hide() {
    speechVisemes = null;
    getAudioTime  = null;
    targetViseme  = 'viseme_sil';

    if (mixer) { mixer.stopAllAction(); mixer = null; }
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    visemeMeshes = [];

    const panel = document.getElementById('avatar-panel');
    if (panel) panel.hidden = true;
  },
};
