/**
 * A small GLB avatar preview for the template editor.
 *
 * Deliberately simpler than the runner's renderer — no lipsync, no idle
 * animation graph, just the head framed the way `avatars.json` says it should
 * be, so the librarian can see who they are configuring.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const DEFAULT_CAMERA = [0, 1.65, 0.5];
const DEFAULT_FOV = 50;

let renderer = null;
let scene = null;
let camera = null;
let model = null;
let mixer = null;
let rafId = null;
let loadToken = 0;
const clock = new THREE.Clock();
const loader = new GLTFLoader();

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
    resize(canvas);
    renderer.render(scene, camera);
  };
  tick();
}

function disposeModel() {
  if (!model) return;
  scene.remove(model);
  model.traverse((node) => {
    if (node.geometry) node.geometry.dispose();
    const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
    for (const material of materials) material.dispose();
  });
  model = null;
  mixer = null;
}

/**
 * Show `entry.file`, framed by the catalogue metadata.
 * Passing null clears the stage.
 */
export async function showAvatar(canvas, entry) {
  if (!renderer) { init(canvas); startLoop(canvas); }

  const token = ++loadToken;
  disposeModel();
  if (!entry?.file) return false;

  const gltf = await loader.loadAsync(`/avatars/${encodeURIComponent(entry.file)}`);
  // A newer request landed while this one was loading — drop this result.
  if (token !== loadToken) return false;

  model = gltf.scene;
  const scale = entry.scale ?? 1;
  model.scale.setScalar(scale);
  const [rx = 0, ry = 0, rz = 0] = entry.rotate ?? [];
  model.rotation.set(rx, ry, rz);
  scene.add(model);

  if (gltf.animations?.length) {
    mixer = new THREE.AnimationMixer(model);
    mixer.clipAction(gltf.animations[0]).play();
  }

  const [cx, cy, cz] = entry.camera ?? DEFAULT_CAMERA;
  camera.fov = entry.fov ?? DEFAULT_FOV;
  camera.position.set(cx, cy, cz);
  camera.lookAt(cx, cy, 0);
  camera.updateProjectionMatrix();
  return true;
}

export function clearAvatar() {
  loadToken++;
  disposeModel();
}
