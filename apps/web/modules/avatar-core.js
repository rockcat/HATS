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
//
// Most rigs ship in a T-pose, arms straight out, which looks like a scarecrow
// rather than a person. Bringing them down sounds like one line, and it has
// been written wrong twice — once about Z and once about Y — because which
// axis lowers an arm depends entirely on how the exporter laid out the bone,
// and that differs between VRM, Mixamo and Ready Player Me.
//
// Measuring the rig settles it. Of the six avatars in the library, max and
// jordan are true T-poses while the other four already hang at about 54°, so
// a fixed correction applied to all of them would push four pairs of arms
// through their own ribs. The angle is read, the shortfall is applied, and
// a model that already looks right is left alone.

/** Where an arm should end up: degrees below horizontal. */
const ARM_REST_DEGREES = 60;

/** Below this much of a correction, the pose is close enough to leave. */
const ARM_SLACK_DEGREES = 5;

/** World-space position of an object, without needing THREE imported. */
function worldPosition(obj) {
  const e = obj.matrixWorld.elements;
  return [e[12], e[13], e[14]];
}

/** How far below horizontal the shoulder-to-elbow line points, in degrees. */
function armAngle(shoulder, elbow) {
  const a = worldPosition(shoulder);
  const b = worldPosition(elbow);
  const v = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const length = Math.hypot(v[0], v[1], v[2]);
  if (length < 1e-6) return ARM_REST_DEGREES; // degenerate: leave it alone
  return Math.asin(-v[1] / length) * 180 / Math.PI;
}

const AXES = ['x', 'y', 'z'];

/**
 * Lower one arm to roughly `ARM_REST_DEGREES` below horizontal.
 *
 * The axis is found by trying all six and keeping whichever actually moved
 * the elbow furthest down — cheaper than being right about six exporters,
 * and it cannot silently do nothing the way a hardcoded axis can. Rotating
 * about the bone's own long axis, which is what the last two attempts did,
 * scores zero and loses.
 *
 * @param {object} root     scene or model root, for updating world matrices
 * @param {object} shoulder the upper-arm bone, rotated in place
 * @param {object} elbow    the forearm bone, used only to measure
 */
export function lowerArm(root, shoulder, elbow) {
  if (!root || !shoulder || !elbow) return;

  root.updateMatrixWorld(true);
  const shortfall = ARM_REST_DEGREES - armAngle(shoulder, elbow);
  if (shortfall < ARM_SLACK_DEGREES) return;

  const radians = shortfall * Math.PI / 180;
  const base = { x: shoulder.rotation.x, y: shoulder.rotation.y, z: shoulder.rotation.z };
  const restore = () => shoulder.rotation.set(base.x, base.y, base.z);

  let best = null;
  for (const axis of AXES) {
    for (const sign of [1, -1]) {
      restore();
      shoulder.rotation[axis] = base[axis] + sign * radians;
      root.updateMatrixWorld(true);
      const angle = armAngle(shoulder, elbow);
      if (!best || angle > best.angle) best = { axis, sign, angle };
    }
  }

  restore();
  if (best) shoulder.rotation[best.axis] = base[best.axis] + best.sign * radians;
  root.updateMatrixWorld(true);
}

export function applyVrmRestPose(vrm) {
  const humanoid = vrm?.humanoid;
  if (!humanoid) return;
  const root = vrm.scene ?? vrm.humanoid?.normalizedHumanBonesRoot;
  for (const side of ['left', 'right']) {
    lowerArm(
      root,
      humanoid.getNormalizedBoneNode(`${side}UpperArm`),
      humanoid.getNormalizedBoneNode(`${side}LowerArm`),
    );
  }
}

// Naming conventions seen in the wild. Ready Player Me and Mixamo both use
// the first; the others are here because a model that matches nothing gets
// no correction at all, silently.
const GLB_ARM_BONES = [
  { shoulder: 'LeftArm',           elbow: 'LeftForeArm' },
  { shoulder: 'RightArm',          elbow: 'RightForeArm' },
  { shoulder: 'mixamorig:LeftArm', elbow: 'mixamorig:LeftForeArm' },
  { shoulder: 'mixamorig:RightArm',elbow: 'mixamorig:RightForeArm' },
  { shoulder: 'Left_arm',          elbow: 'Left_forearm' },
  { shoulder: 'Right_arm',         elbow: 'Right_forearm' },
];

export function applyGlbRestPose(scene) {
  if (!scene) return;
  const bones = {};
  scene.traverse(obj => { if (obj.isBone) bones[obj.name] = obj; });

  for (const pair of GLB_ARM_BONES) {
    lowerArm(scene, bones[pair.shoulder], bones[pair.elbow]);
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
