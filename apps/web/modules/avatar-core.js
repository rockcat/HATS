// Shared avatar animation helpers — no external imports, safe in any JS environment.
// Used by apps/web/avatar.js and the Flutter WebView (avatar_view.dart).

// ── VRM viseme mapping ────────────────────────────────────────────────────────
// Maps server ARKit viseme names (Rhubarb A–H/X) to VRM 1.x vowel expressions.
export const VISEME_TO_VRM = {
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
  viseme_TH:  {},
};

// All VRM vowel expressions managed during lipsync.
export const VRM_VOWELS = ['aa', 'ih', 'ou', 'ee', 'oh'];

// ── A-pose correction ─────────────────────────────────────────────────────────
const ARM_DOWN = Math.PI / 3; // ~60° — T-pose to natural resting A-pose

// VRM normalized space: left local-Y → global -X, right local-Y → global +X.
// Rotating +Z lowers left arm; rotating -Z lowers right arm.
export function applyVrmRestPose(vrm) {
  const left  = vrm.humanoid?.getNormalizedBoneNode('leftUpperArm');
  const right = vrm.humanoid?.getNormalizedBoneNode('rightUpperArm');
  if (left)  left.rotation.z  =  ARM_DOWN;
  if (right) right.rotation.z = -ARM_DOWN;
}

// GLB (Mixamo/RPM) bone space: left local-Y → global +X, right local-Y → global -X.
// Signs are opposite to VRM because raw Mixamo bones aren't normalized.
// Tries common naming conventions and applies the first match found.
const GLB_ARM_PAIRS = [
  ['LeftArm',          'RightArm'],
  ['Left_arm',         'Right_arm'],
  ['mixamorig:LeftArm','mixamorig:RightArm'],
];

export function applyGlbRestPose(scene) {
  const bones = {};
  scene.traverse(obj => { if (obj.isBone) bones[obj.name] = obj; });

  for (const [leftName, rightName] of GLB_ARM_PAIRS) {
    const left  = bones[leftName];
    const right = bones[rightName];
    if (left && right) {
      left.rotation.z  = ARM_DOWN;
      right.rotation.z = -ARM_DOWN;
      return;
    }
  }
}

// ── Idle motion (breathing + head sway) ───────────────────────────────────────
export function stepIdleMotion(vrm, elapsed) {
  const spine = vrm.humanoid?.getNormalizedBoneNode('spine');
  if (spine) spine.rotation.x = Math.sin(elapsed * Math.PI * 0.4) * 0.018;
  const head = vrm.humanoid?.getNormalizedBoneNode('head');
  if (head) {
    head.rotation.z = Math.sin(elapsed * 0.37) * 0.012 + Math.sin(elapsed * 0.71) * 0.007;
    head.rotation.y = Math.sin(elapsed * 0.23) * 0.010 + Math.sin(elapsed * 0.59) * 0.005;
  }
}

// ── Blink state machine ───────────────────────────────────────────────────────
export const BLINK_HALF = 0.07; // seconds per blink half (close + open = ~140 ms)

/** Create a fresh blink state object. Call once per model load. */
export function makeBlink() {
  return { timer: 0, next: 2 + Math.random() * 3, phase: 'open', t: 0 };
}

/**
 * Advance the blink state machine one frame.
 * `applyFn` receives the current blink value (0 = open, 1 = closed).
 * Works for both VRM (pass `v => em.setValue('blink', v)`) and
 * GLB (pass `v => applyBlinkMeshes(meshes, v)`).
 */
export function stepBlink(state, applyFn, delta) {
  if (!applyFn) return;
  if (state.phase === 'open') {
    state.timer += delta;
    if (state.timer >= state.next) {
      state.phase = 'closing'; state.t = 0; state.timer = 0;
      state.next = 2 + Math.random() * 4;
    }
  } else {
    state.t += delta / BLINK_HALF;
    const progress = Math.min(state.t, 1);
    applyFn(state.phase === 'closing' ? progress : 1 - progress);
    if (progress >= 1) {
      if (state.phase === 'closing') { state.phase = 'opening'; state.t = 0; }
      else                          { state.phase = 'open'; applyFn(0); }
    }
  }
}

// ── GLB blink helpers ─────────────────────────────────────────────────────────

/**
 * Find all meshes in a GLB scene that carry eyeBlinkLeft / eyeBlinkRight
 * morph targets (standard Ready Player Me naming).
 */
export function collectBlinkMeshes(scene) {
  const result = [];
  scene.traverse(obj => {
    if (!obj.isMesh || !obj.morphTargetDictionary) return;
    const li = obj.morphTargetDictionary['eyeBlinkLeft']  ?? -1;
    const ri = obj.morphTargetDictionary['eyeBlinkRight'] ?? -1;
    if (li >= 0 || ri >= 0) result.push({ mesh: obj, li, ri });
  });
  return result;
}

/** Apply a blink value (0–1) to both eye morph targets on each mesh. */
export function applyBlinkMeshes(blinkMeshes, value) {
  for (const { mesh, li, ri } of blinkMeshes) {
    if (li >= 0) mesh.morphTargetInfluences[li] = value;
    if (ri >= 0) mesh.morphTargetInfluences[ri] = value;
  }
}
