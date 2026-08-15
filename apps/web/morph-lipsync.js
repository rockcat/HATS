// morph-lipsync.js — shared ARKit viseme morph animation helpers
// Used by avatar.js (browser), meeting.js (browser), and glb-renderer.ts (Node/server).
// No browser-specific APIs — safe to import in any JS/TS environment.

export const BLEND = 0.4; // lerp speed per frame

export const BODY_KEYWORDS = ['torso', 'chest', 'body', 'shoulder', 'arm', 'hand',
                               'leg', 'foot', 'toe', 'hips', 'spine'];

/**
 * Traverse a Three.js scene and return all meshes that have viseme_* morph targets.
 * Also hides body meshes (non-face geometry).
 * @param {object} scene - THREE.Object3D scene root
 * @returns {object[]} array of THREE.Mesh objects with viseme morphs
 */
export function collectVisemeMeshes(scene) {
  const meshes = [];
  scene.traverse(obj => {
    if (!obj.isMesh) return;
    const low = obj.name.toLowerCase();
    if (BODY_KEYWORDS.some(kw => low.includes(kw))) {
      obj.visible = false;
      return;
    }
    if (obj.morphTargetDictionary) {
      const keys = Object.keys(obj.morphTargetDictionary);
      if (keys.some(k => k.startsWith('viseme_')) && !meshes.includes(obj)) {
        meshes.push(obj);
      }
    }
  });
  return meshes;
}

/**
 * Advance morph weight map one frame: decay all weights toward 0,
 * then blend targetViseme weight toward 1.
 * Mutates and returns the weights object.
 * @param {Record<string,number>} weights - mutable morph weight map
 * @param {string} targetViseme - current target viseme key (e.g. 'viseme_aa')
 * @returns {Record<string,number>} the same weights object
 */
export function stepMorphWeights(weights, targetViseme) {
  for (const key of Object.keys(weights)) {
    weights[key] *= (1 - BLEND);
    if (weights[key] < 0.001) delete weights[key];
  }
  if (targetViseme) {
    const cur = weights[targetViseme] ?? 0;
    weights[targetViseme] = cur + BLEND * (1 - cur);
  }
  return weights;
}

/**
 * Write the morph weight map to morphTargetInfluences on each mesh.
 * Only keys that start with 'viseme_' are written.
 * @param {object[]} meshes - THREE.Mesh[] collected by collectVisemeMeshes
 * @param {Record<string,number>} weights - morph weight map
 */
export function applyMorphWeights(meshes, weights) {
  for (const mesh of meshes) {
    const dict = mesh.morphTargetDictionary;
    const infl = mesh.morphTargetInfluences;
    if (!dict || !infl) continue;
    for (const key of Object.keys(dict)) {
      if (key.startsWith('viseme_')) infl[dict[key]] = weights[key] ?? 0;
    }
  }
}
