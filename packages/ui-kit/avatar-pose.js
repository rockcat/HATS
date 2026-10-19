// ── Getting an avatar's arms down ─────────────────────────────────────────────
//
// Most rigs ship in a T-pose, arms straight out, which reads as a scarecrow
// rather than a person. Bringing them down sounds like one line and has been
// written wrong three times now — twice about which axis, and once by only
// ever applying it to VRM models while the GLB ones stood there with their
// arms out.
//
// No imports and no THREE: everything needed is on the objects themselves, so
// this can be shared by every renderer and tested without a canvas.
//
// Measuring the rig is what makes it reliable. Which axis lowers an arm
// depends on how the exporter laid out the bone, and VRM, Mixamo and Ready
// Player Me all differ — so rather than knowing, it tries all six and keeps
// whichever actually moved the elbow down. Rotating about the bone's own
// length scores zero and loses, which is exactly the mistake that shipped.

/** Where an arm should end up: degrees below horizontal. */
export const ARM_REST_DEGREES = 60;

/** Below this much of a correction, the pose is close enough to leave alone. */
export const ARM_SLACK_DEGREES = 5;

const AXES = ['x', 'y', 'z'];

/** World position of an object, without needing THREE imported. */
function worldPosition(obj) {
  const e = obj.matrixWorld.elements;
  return [e[12], e[13], e[14]];
}

/** How far below horizontal the shoulder-to-elbow line points, in degrees. */
export function armAngle(shoulder, elbow) {
  const a = worldPosition(shoulder);
  const b = worldPosition(elbow);
  const v = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const length = Math.hypot(v[0], v[1], v[2]);
  if (length < 1e-6) return ARM_REST_DEGREES; // degenerate: leave it be
  return Math.asin(-v[1] / length) * 180 / Math.PI;
}

/**
 * Lower one arm to roughly `ARM_REST_DEGREES` below horizontal.
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

/** A VRM, through its normalised humanoid bones. */
export function applyVrmRestPose(vrm) {
  const humanoid = vrm?.humanoid;
  if (!humanoid) return;
  const root = vrm.scene ?? humanoid.normalizedHumanBonesRoot;
  for (const side of ['left', 'right']) {
    lowerArm(
      root,
      humanoid.getNormalizedBoneNode(`${side}UpperArm`),
      humanoid.getNormalizedBoneNode(`${side}LowerArm`),
    );
  }
}

// Naming conventions seen in the wild. Ready Player Me and Mixamo both use the
// first; the others are here because a model matching none of them gets no
// correction at all, silently.
const GLB_ARM_BONES = [
  { shoulder: 'LeftArm',            elbow: 'LeftForeArm' },
  { shoulder: 'RightArm',           elbow: 'RightForeArm' },
  { shoulder: 'mixamorig:LeftArm',  elbow: 'mixamorig:LeftForeArm' },
  { shoulder: 'mixamorig:RightArm', elbow: 'mixamorig:RightForeArm' },
  { shoulder: 'Left_arm',           elbow: 'Left_forearm' },
  { shoulder: 'Right_arm',          elbow: 'Right_forearm' },
];

/** A plain GLB, by bone name. */
export function applyGlbRestPose(scene) {
  if (!scene) return;
  const bones = {};
  scene.traverse((obj) => { if (obj.isBone) bones[obj.name] = obj; });
  for (const pair of GLB_ARM_BONES) {
    lowerArm(scene, bones[pair.shoulder], bones[pair.elbow]);
  }
}

/**
 * Pose whatever was loaded, VRM or not.
 *
 * The single entry point, because the bug this replaces was a renderer that
 * posed VRMs and quietly left every GLB in its T-pose.
 */
export function applyRestPose(gltf, vrm) {
  if (vrm) applyVrmRestPose(vrm);
  else applyGlbRestPose(gltf?.scene ?? gltf);
}
