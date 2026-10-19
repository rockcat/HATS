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
    if (vrm) vrm.update(delta);
    resize(canvas);
    renderer.render(scene, camera);
  };
  tick();
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
