// ── Avatar thumbnails ─────────────────────────────────────────────────────────
//
// Still portraits of the 3D avatars, for places that show many at once such as
// the Agent Library grid. A live renderer per card would run out of WebGL
// contexts (browsers allow about 16 a page), so one hidden renderer draws each
// avatar file once, in turn, and keeps the picture as a data URL. The model is
// freed as soon as it has been drawn.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import { applyVrmRestPose, applyGlbRestPose } from './avatar-core.js';

/** Portrait size in pixels; 3:4, like the cards it fills. */
const WIDTH  = 240;
const HEIGHT = 320;

/** Framing for an avatar missing from avatars.json: head and shoulders of an adult. */
const DEFAULT_VIEW = { camera: [0, 1.6, 0.5], rotate: [0, 0, 0], fov: 50, scale: 1 };

/** file → Promise of a data URL, or null when it could not be drawn. */
const thumbs = new Map();
/** Draws run one after another on the shared renderer. */
let queue = Promise.resolve();
let stage = null;

/** The renderer, scene and camera, made on first use. Null when WebGL is unavailable. */
function getStage() {
  if (stage !== null) return stage || null;
  try {
    const canvas   = document.createElement('canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(1);
    renderer.setSize(WIDTH, HEIGHT, false);

    // The same lights as the live avatar, so a thumbnail looks like the meeting.
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const key = new THREE.DirectionalLight(0xffffff, 0.6);
    key.position.set(1, 2, 2);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.3);
    fill.position.set(-1, 0, 1);
    scene.add(fill);

    stage = { renderer, scene, camera: new THREE.PerspectiveCamera(50, WIDTH / HEIGHT, 0.1, 100) };
  } catch {
    stage = false;
  }
  return stage || null;
}

function loadModel(file) {
  const loader = new GLTFLoader();
  if (file.toLowerCase().endsWith('.vrm')) loader.register((parser) => new VRMLoaderPlugin(parser));
  return loader.loadAsync(`/avatars/${encodeURIComponent(file)}`);
}

/** Free the GPU memory a model holds. */
function dispose(root) {
  root.traverse((node) => {
    node.geometry?.dispose();
    const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
    for (const m of materials) {
      for (const value of Object.values(m)) if (value?.isTexture) value.dispose();
      m.dispose();
    }
  });
}

/** Draw one avatar, framed as avatars.json says, and return it as a PNG data URL. */
async function draw(file, view) {
  const s = getStage();
  if (!s) return null;
  const gltf  = await loadModel(file);
  const model = gltf.scene;
  const { camera: pos, rotate, fov, scale } = { ...DEFAULT_VIEW, ...view };

  const DEG = Math.PI / 180;
  model.rotation.set(rotate[0] * DEG, rotate[1] * DEG, rotate[2] * DEG);
  model.scale.setScalar(scale ?? 1);

  const vrm = gltf.userData.vrm;
  if (vrm) {
    applyVrmRestPose(vrm);
    vrm.update(0);
  } else {
    applyGlbRestPose(model);
  }

  // As the live avatar does: look straight ahead, a little below eye level.
  s.camera.fov = fov ?? 50;
  s.camera.position.set(pos[0], pos[1], pos[2]);
  s.camera.lookAt(new THREE.Vector3(pos[0], pos[1] - 0.08, 0));
  s.camera.updateProjectionMatrix();

  s.scene.add(model);
  try {
    s.renderer.render(s.scene, s.camera);
    return s.renderer.domElement.toDataURL('image/png');
  } finally {
    s.scene.remove(model);
    dispose(model);
  }
}

/**
 * A still portrait of an avatar file, drawn once and kept for the page's life.
 *
 * @param {string} file  - avatar filename, e.g. "casey.glb"
 * @param {object} [view] - its avatars.json entry (camera, rotate, fov, scale)
 * @returns {Promise<string|null>} a data URL, or null if it could not be drawn
 */
export function avatarThumbnail(file, view) {
  if (!file) return Promise.resolve(null);
  if (!thumbs.has(file)) {
    const next = queue.then(() => draw(file, view)).catch((err) => {
      console.warn(`[AvatarThumbs] could not draw ${file}:`, err?.message ?? err);
      return null;
    });
    queue = next;
    thumbs.set(file, next);
  }
  return thumbs.get(file);
}
