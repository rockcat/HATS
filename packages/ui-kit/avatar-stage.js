/**
 * A GLB / VRM avatar stage, shared by every HATS front-end that shows a face.
 *
 * Deliberately simpler than the runner's renderer — no lipsync — but it loads
 * the same models, framed the way the avatar catalogue says, so an agent looks
 * the same in the library editor as it does when it is running.
 *
 * The model is addressed by URL rather than by filename, because the callers
 * fetch it from different places: the Agent Library serves `/avatars/<file>`,
 * while an Embodiment API client gets `/agents/<id>/avatar`.
 *
 * Pair it with `avatar-stage.css`, which lays out the background and canvas.
 */

import * as THREE from 'three';
import { applyRestPose } from '/ui-kit/avatar-pose.js';
import {
  applyMorphWeights, applyVrmWeights, chatterVisemeAt, collectVisemeMeshes,
  isFinished, morphTargetFor, stepWeights, visemeAt, vrmTargetFor,
} from '/ui-kit/avatar-lipsync.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const DEFAULT_CAMERA = [0, 1.65, 0.5];
const DEFAULT_FOV = 50;
const DEG = Math.PI / 180;
/** VRM models load in a T-pose; drop the upper arms to a natural rest. */


let renderer = null;
let scene = null;
let camera = null;
let model = null;
let vrm = null;
let mixer = null;
let rafId = null;
let loadToken = 0;

/** The sentence being mouthed: its timeline, when it started, and the meshes. */
let lip = { timeline: null, chatter: false, startedAt: 0, meshes: [], weights: {} };
const clock = new THREE.Clock();

const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));

function init(canvas) {
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(DEFAULT_FOV, 1, 0.1, 100);

  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 0.7);
  key.position.set(1, 2, 2);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.35);
  fill.position.set(-1, 0, 1);
  scene.add(fill);
}

function resize(canvas) {
  const width = canvas.clientWidth || 260;
  const height = canvas.clientHeight || 260;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function startLoop(canvas) {
  if (rafId !== null) return;
  const tick = () => {
    rafId = requestAnimationFrame(tick);
    const delta = clock.getDelta();
    if (mixer) mixer.update(delta);
    stepLipSync();
    // After the mouth, because vrm.update() is what commits expression values.
    if (vrm) vrm.update(delta);
    resize(canvas);
    renderer.render(scene, camera);
  };
  tick();
}

/**
 * Advance the mouth one frame.
 *
 * Timed from `performance.now()` against the timeline's own seconds rather
 * than counted in frames: a dropped frame would otherwise slide the mouth out
 * of step with the audio and never catch up.
 */
function stepLipSync() {
  if (!model) return;

  const talking = lip.timeline || lip.chatter;
  const elapsed = talking ? (performance.now() - lip.startedAt) / 1000 : 0;
  const viseme = lip.timeline ? visemeAt(lip.timeline, elapsed)
    : lip.chatter ? chatterVisemeAt(elapsed)
    : 'viseme_sil';
  const target = vrm ? vrmTargetFor(viseme) : morphTargetFor(viseme);

  lip.weights = stepWeights(lip.weights, target);

  if (vrm) applyVrmWeights(vrm, lip.weights);
  else if (lip.meshes.length) applyMorphWeights(lip.meshes, viseme, lip.weights);

  // Keep stepping after the words end so the mouth closes, then stop.
  if (lip.timeline && isFinished(lip.timeline, elapsed)
      && Object.values(lip.weights).every((v) => v === 0)) {
    lip.timeline = null;
  }
}

/**
 * Mouth a sentence, starting now.
 *
 * Call it as the audio starts playing, not when it is requested — the gap
 * between asking for audio and hearing it is exactly the drift this would
 * otherwise bake in.
 *
 * With no timeline it falls back to plausible movement, because the browser's
 * own voice reports only "started" and "ended". An approximate mouth is not
 * the same kind of thing as a motionless one: only the second looks broken.
 *
 * @param {Array<{viseme: string, start: number, end: number}>} [timeline]
 */
export function applyLipSync(timeline) {
  const timed = Array.isArray(timeline) && timeline.length ? timeline : null;
  lip.timeline = timed;
  lip.chatter = !timed;
  lip.startedAt = performance.now();
}

/** Stop mouthing. The mouth then closes over the next few frames. */
export function stopLipSync() {
  lip.timeline = null;
  lip.chatter = false;
}

function disposeModel() {
  if (vrm) { VRMUtils.deepDispose(vrm.scene); vrm = null; }
  if (model) {
    scene.remove(model);
    model.traverse((node) => {
      if (node.geometry) node.geometry.dispose();
      const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
      for (const material of materials) material.dispose();
    });
    model = null;
  }
  mixer = null;
  lip = { timeline: null, chatter: false, startedAt: 0, meshes: [], weights: {} };
}



/**
 * Show the model at `spec.url`, framed by `camera` / `rotate` / `fov` / `scale`.
 * Passing a spec without a URL clears the stage.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{url?: string, camera?: number[], rotate?: number[], fov?: number, scale?: number}} [spec]
 * @returns {Promise<boolean>} true when a model is now on the stage
 */
export async function showAvatar(canvas, spec) {
  if (!renderer) { init(canvas); startLoop(canvas); }

  const token = ++loadToken;
  disposeModel();
  if (!spec?.url) return false;

  const gltf = await loader.loadAsync(spec.url);
  // A newer request landed while this one was loading — drop this result.
  if (token !== loadToken) return false;

  const loadedVrm = gltf.userData?.vrm ?? null;
  if (loadedVrm) {
    vrm = loadedVrm;
    model = loadedVrm.scene;
    // Removing unused vertices and joints keeps the preview cheap.
    VRMUtils.removeUnnecessaryVertices(model);
    VRMUtils.combineSkeletons(model);
  } else {
    model = gltf.scene;
  }

  // Every model, not only the VRMs. This used to pose VRMs and leave each
  // GLB standing with its arms out — which is most of the avatar library.
  applyRestPose(gltf, loadedVrm);
  // Once per model: walking the scene every frame to find the mouth would
  // cost more than the lip-sync itself.
  lip.meshes = loadedVrm ? [] : collectVisemeMeshes(model);

  model.scale.setScalar(spec.scale ?? 1);
  // `rotate` in the catalogue is degrees, matching the runner's renderer.
  const [rx = 0, ry = 0, rz = 0] = spec.rotate ?? [];
  model.rotation.set(rx * DEG, ry * DEG, rz * DEG);
  scene.add(model);

  if (!loadedVrm && gltf.animations?.length) {
    mixer = new THREE.AnimationMixer(model);
    mixer.clipAction(gltf.animations[0]).play();
  }

  const [cx, cy, cz] = spec.camera ?? DEFAULT_CAMERA;
  camera.fov = spec.fov ?? DEFAULT_FOV;
  camera.position.set(cx, cy, cz);
  camera.lookAt(cx, cy - 0.08, 0);
  camera.updateProjectionMatrix();
  return true;
}

export function clearAvatar() {
  loadToken++;
  disposeModel();
}
