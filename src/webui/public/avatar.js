// avatar.js — Three.js GLB/VRM avatar renderer with audio-aligned lipsync
// Loaded as <script type="module">; exposes window.avatarAPI for app.js.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMExpressionPresetName } from '@pixiv/three-vrm';
import { collectVisemeMeshes, stepMorphWeights, applyMorphWeights } from './morph-lipsync.js';

// ── VRM viseme mapping (HATS viseme_* → VRM vowel expressions) ───────────────
const VISEME_TO_VRM = {
  viseme_sil: {},
  viseme_aa:  { aa: 1.0 },
  viseme_E:   { ee: 1.0 },
  viseme_O:   { oh: 1.0 },
  viseme_U:   { ou: 1.0 },
  viseme_OO:  { ou: 0.8 },
  viseme_PP:  {},
  viseme_FF:  { ih: 0.7 },
  viseme_nn:  { ih: 0.4, aa: 0.2 },
  viseme_SS:  { ih: 0.5 },
};
const VRM_VOWELS = ['aa', 'ih', 'ou', 'ee', 'oh'];

// Rotate upper arms ~60° downward from T-pose to a natural resting A-pose.
// VRM normalized space: right arm extends +X, left extends -X, so signs differ.
const ARM_DOWN = Math.PI / 3;
function applyVrmRestPose(v) {
  const left  = v.humanoid?.getNormalizedBoneNode('leftUpperArm');
  const right = v.humanoid?.getNormalizedBoneNode('rightUpperArm');
  if (left)  left.rotation.z  =  ARM_DOWN;
  if (right) right.rotation.z = -ARM_DOWN;
}

// ── Lipsync state ─────────────────────────────────────────────────────────────

let targetViseme = 'viseme_sil';
const morphWeights = {};

// Speech-aligned lipsync
let speechVisemes  = null;  // VisemeEvent[] | null
let getAudioTime   = null;  // () => number | null
let speechDuration = 0;     // seconds — decoded audio duration of current chunk

// ── Three.js ─────────────────────────────────────────────────────────────────

let renderer      = null;
let currentCanvas = null;
let scene    = null;
let camera   = null;
let rafId    = null;
let visemeMeshes = [];
let loadGen  = 0; // incremented each loadGLB call; stale async callbacks check this
let glbLoaded = Promise.resolve(); // resolves when current GLB finishes loading

// Idle animation (GLB)
let mixer    = null; // THREE.AnimationMixer | null
let clock    = new THREE.Clock();

// VRM state
let vrm          = null;  // VRM instance | null
let vrmWeights   = {};    // live vowel weights for smooth lerp
// VRM blink idle
let blinkTimer   = 0;
let nextBlink    = 2 + Math.random() * 3;
let blinkPhase   = 'open'; // 'open' | 'closing' | 'opening'
let blinkT       = 0;
const BLINK_HALF = 0.07;

function initRenderer(canvas) {
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  currentCanvas = canvas;
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
  const parent = canvas.parentElement;
  const w = canvas.clientWidth  || parent?.clientWidth  || 320;
  const h = canvas.clientHeight || parent?.clientHeight || 320;
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function loadGLB(file, camPos, rotate, fov, scale) {
  // Remove old avatar nodes (keep lights) and reset state
  const toRemove = scene.children.filter(c => !c.isLight);
  for (const c of toRemove) scene.remove(c);
  visemeMeshes = [];
  vrm = null;
  vrmWeights = {};
  if (mixer) { mixer.stopAllAction(); mixer = null; }
  clock.getDelta(); // reset clock delta

  const gen = ++loadGen;
  let resolveLoaded;
  glbLoaded = new Promise(res => { resolveLoaded = res; });

  const isVRM = file.toLowerCase().endsWith('.vrm');
  const loader = new GLTFLoader();
  if (isVRM) loader.register(parser => new VRMLoaderPlugin(parser));

  loader.load(`/avatars/${file}`, gltf => {
    if (gen !== loadGen) { resolveLoaded(); return; }

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

    if (isVRM && gltf.userData.vrm) {
      vrm = gltf.userData.vrm;
      applyVrmRestPose(vrm);
      // Reset blink idle timer
      blinkTimer = 0; blinkPhase = 'open'; blinkT = 0;
      nextBlink = 2 + Math.random() * 3;
      console.log('[Avatar] VRM loaded — spring bones + blink idle active');
    } else {
      visemeMeshes = collectVisemeMeshes(gltf.scene);
      if (gltf.animations?.length > 0) {
        mixer = new THREE.AnimationMixer(gltf.scene);
        for (const clip of gltf.animations) mixer.clipAction(clip).play();
        console.log(`[Avatar] ${gltf.animations.length} idle animation(s) started`);
      }
    }

    resolveLoaded();
  }, undefined, () => resolveLoaded());
}

function renderLoop() {
  rafId = requestAnimationFrame(renderLoop);

  const delta = clock.getDelta();

  // Determine target viseme from time-aligned speech data
  if (getAudioTime) {
    const t = Math.max(0, getAudioTime());
    const withinAudio = t < speechDuration;
    if (speechVisemes && speechVisemes.length > 0) {
      const cue = speechVisemes.find(v => t >= v.start && t < v.end);
      if (cue)              targetViseme = cue.viseme;
      else if (withinAudio) targetViseme = Math.floor(t / 0.18) % 2 === 0 ? 'viseme_aa' : 'viseme_sil';
      else                  targetViseme = 'viseme_sil';
    } else {
      targetViseme = withinAudio
        ? (Math.floor(t / 0.18) % 2 === 0 ? 'viseme_aa' : 'viseme_sil')
        : 'viseme_sil';
    }
  }

  if (vrm) {
    // ── VRM render path ───────────────────────────────────────────────────
    const em = vrm.expressionManager;
    if (em) {
      // Lipsync: lerp vowel expressions
      const target = VISEME_TO_VRM[targetViseme] ?? {};
      for (const v of VRM_VOWELS) {
        const t   = target[v] ?? 0;
        const cur = vrmWeights[v] ?? 0;
        vrmWeights[v] = cur + (t - cur) * 0.35;
        em.setValue(v, vrmWeights[v]);
      }
      // Blink idle
      if (blinkPhase === 'open') {
        blinkTimer += delta;
        if (blinkTimer >= nextBlink) {
          blinkPhase = 'closing'; blinkT = 0; blinkTimer = 0;
          nextBlink = 2 + Math.random() * 4;
        }
      } else {
        blinkT += delta / BLINK_HALF;
        const progress = Math.min(blinkT, 1);
        em.setValue('blink', blinkPhase === 'closing' ? progress : 1 - progress);
        if (progress >= 1) {
          if (blinkPhase === 'closing') { blinkPhase = 'opening'; blinkT = 0; }
          else                         { blinkPhase = 'open'; }
        }
      }
    }
    vrm.update(delta); // spring bones + expression flush
  } else {
    // ── GLB render path ───────────────────────────────────────────────────
    if (mixer) mixer.update(delta);
    stepMorphWeights(morphWeights, targetViseme);
    applyMorphWeights(visemeMeshes, morphWeights);
  }

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
  show(avatarFile, cameraPos, rotate, fov, scale, bgFile, panelId = 'avatar-panel', canvasId = 'avatar-canvas') {
    const panel  = document.getElementById(panelId);
    const canvas = document.getElementById(canvasId);
    if (!panel || !canvas) return;

    panel.hidden = false;
    panel.style.backgroundImage = bgFile
      ? `url('/backgrounds/${encodeURIComponent(bgFile)}')`
      : '';

    if (!renderer || currentCanvas !== canvas) initRenderer(canvas);
    void panel.offsetWidth; // flush layout so canvas dimensions are correct
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
  hide(panelId = 'avatar-panel') {
    speechVisemes = null;
    getAudioTime  = null;
    targetViseme  = 'viseme_sil';

    if (mixer) { mixer.stopAllAction(); mixer = null; }
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    visemeMeshes = [];

    const panel = document.getElementById(panelId);
    if (panel) panel.hidden = true;
  },
};
