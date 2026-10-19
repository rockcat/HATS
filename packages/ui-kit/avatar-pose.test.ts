/**
 * Lowering an avatar's arms, in the shared renderer.
 *
 * The bug this covers was invisible to any test that did not use a real model:
 * the code set a rotation, the rotation was applied, and the arm did not move,
 * because it was turning the bone about its own length. Twice — once about Z,
 * once about Y.
 *
 * So these load the actual GLBs from the avatar library and measure where the
 * elbow ends up, with just enough of three.js's Object3D to run against.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
// @ts-expect-error — a browser module with no imports, so it loads here.
import { applyGlbRestPose, applyRestPose, lowerArm } from './avatar-pose.js';

const AVATARS = 'runtime_data/avatars';

// ── Just enough of three.js ──────────────────────────────────────────────────

type Mat = number[];

const identity = (): Mat => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];

function multiply(a: Mat, b: Mat): Mat {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r]! * b[c * 4 + k]!;
  return out;
}

function fromQuaternion(t: number[], q: number[], s: number[]): Mat {
  const [x, y, z, w] = q as [number, number, number, number];
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0]!, (xy + wz) * s[0]!, (xz - wy) * s[0]!, 0,
    (xy - wz) * s[1]!, (1 - (xx + zz)) * s[1]!, (yz + wx) * s[1]!, 0,
    (xz + wy) * s[2]!, (yz - wx) * s[2]!, (1 - (xx + yy)) * s[2]!, 0,
    t[0]!, t[1]!, t[2]!, 1,
  ];
}

/** Euler XYZ → matrix, matching three.js's default order. */
function fromEuler(t: number[], e: { x: number; y: number; z: number }, s: number[]): Mat {
  const cx = Math.cos(e.x), sx = Math.sin(e.x);
  const cy = Math.cos(e.y), sy = Math.sin(e.y);
  const cz = Math.cos(e.z), sz = Math.sin(e.z);
  const m = [
    cy * cz, cx * sz + sx * sy * cz, sx * sz - cx * sy * cz,
    -cy * sz, cx * cz - sx * sy * sz, sx * cz + cx * sy * sz,
    sy, -sx * cy, cx * cy,
  ];
  return [
    m[0]! * s[0]!, m[1]! * s[0]!, m[2]! * s[0]!, 0,
    m[3]! * s[1]!, m[4]! * s[1]!, m[5]! * s[1]!, 0,
    m[6]! * s[2]!, m[7]! * s[2]!, m[8]! * s[2]!, 0,
    t[0]!, t[1]!, t[2]!, 1,
  ];
}

class FakeEuler {
  x = 0;
  y = 0;
  z = 0;

  set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; }
}

/**
 * Quaternion → Euler XYZ, as three.js's Euler.setFromRotationMatrix does.
 *
 * Without this the fake would start every bone at (0,0,0) and quietly
 * straighten any rig whose rest pose is stored as a quaternion — which is
 * all of them.
 */
function eulerFromQuaternion(q: number[]): { x: number; y: number; z: number } {
  const m = fromQuaternion([0, 0, 0], q, [1, 1, 1]);
  const m11 = m[0]!, m12 = m[4]!, m13 = m[8]!;
  const m22 = m[5]!, m23 = m[9]!;
  const m32 = m[6]!, m33 = m[10]!;
  const y = Math.asin(Math.max(-1, Math.min(1, m13)));
  if (Math.abs(m13) < 0.9999999) {
    return { x: Math.atan2(-m23, m33), y, z: Math.atan2(-m12, m11) };
  }
  return { x: Math.atan2(m32, m22), y, z: 0 };
}

class FakeObject3D {
  name = '';
  isBone = true;
  children: FakeObject3D[] = [];
  parent: FakeObject3D | null = null;
  position = [0, 0, 0];
  scale = [1, 1, 1];
  quaternion = [0, 0, 0, 1];
  /** Set by the code under test; when touched it replaces the quaternion. */
  rotation = new FakeEuler();
  matrixWorld = { elements: identity() };

  add(child: FakeObject3D) { child.parent = this; this.children.push(child); return this; }

  traverse(fn: (o: FakeObject3D) => void) {
    fn(this);
    for (const c of this.children) c.traverse(fn);
  }

  updateMatrixWorld(_force?: boolean) {
    const local = fromEuler(this.position, this.rotation, this.scale);
    const parent = this.parent?.matrixWorld.elements ?? identity();
    this.matrixWorld.elements = multiply(parent, local);
    for (const c of this.children) c.updateMatrixWorld(true);
  }
}



// ── Loading a real rig ───────────────────────────────────────────────────────

function readGlbJson(path: string) {
  const buf = readFileSync(path);
  let offset = 12;
  while (offset < buf.length) {
    const length = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    if (type === 0x4e4f534a) {
      return JSON.parse(buf.subarray(offset + 8, offset + 8 + length).toString('utf8'));
    }
    offset += 8 + length + ((4 - (length % 4)) % 4);
  }
  throw new Error('no JSON chunk');
}

/** Build the node hierarchy as three.js would, minus everything irrelevant. */
function loadRig(file: string): FakeObject3D {
  const gltf = readGlbJson(join(AVATARS, file));
  const nodes: FakeObject3D[] = (gltf.nodes ?? []).map((n: Record<string, unknown>) => {
    const o = new FakeObject3D();
    o.name = (n['name'] as string) ?? '';
    o.position = (n['translation'] as number[]) ?? [0, 0, 0];
    o.quaternion = (n['rotation'] as number[]) ?? [0, 0, 0, 1];
    const e = eulerFromQuaternion(o.quaternion);
    o.rotation.set(e.x, e.y, e.z);
    o.scale = (n['scale'] as number[]) ?? [1, 1, 1];
    return o;
  });
  (gltf.nodes ?? []).forEach((n: Record<string, unknown>, i: number) => {
    for (const c of ((n['children'] as number[]) ?? [])) nodes[i]!.add(nodes[c]!);
  });

  const root = new FakeObject3D();
  root.isBone = false;
  for (const n of nodes) if (!n.parent) root.add(n);
  root.updateMatrixWorld(true);
  return root;
}

const find = (root: FakeObject3D, name: string) => {
  let found: FakeObject3D | null = null;
  root.traverse((o) => { if (o.name === name) found = o; });
  return found as FakeObject3D | null;
};

/** Degrees below horizontal, the measure that matters. */
function armAngle(root: FakeObject3D, side: 'Left' | 'Right'): number {
  root.updateMatrixWorld(true);
  const shoulder = find(root, `${side}Arm`)!;
  const elbow = find(root, `${side}ForeArm`)!;
  const a = shoulder.matrixWorld.elements;
  const b = elbow.matrixWorld.elements;
  const v = [b[12]! - a[12]!, b[13]! - a[13]!, b[14]! - a[14]!];
  const length = Math.hypot(v[0]!, v[1]!, v[2]!);
  return Math.asin(-v[1]! / length) * 180 / Math.PI;
}

const models = existsSync(AVATARS)
  ? readdirSync(AVATARS).filter((f) => f.endsWith('.glb'))
  : [];

describe('lowering a T-posed avatar\'s arms', () => {
  it('finds the avatar library to test against', () => {
    expect(models.length).toBeGreaterThan(0);
  });

  it.each(['max.glb', 'jordan.glb'].filter((m) => models.includes(m)))(
    'brings %s down out of its T-pose', (file) => {
      const rig = loadRig(file);
      expect(armAngle(rig, 'Left')).toBeLessThan(10); // it really is a T

      applyGlbRestPose(rig);

      expect(armAngle(rig, 'Left')).toBeGreaterThan(45);
      expect(armAngle(rig, 'Right')).toBeGreaterThan(45);
    });

  it.each(models)('leaves %s with both arms down, whatever it started as', (file) => {
    const rig = loadRig(file);
    applyGlbRestPose(rig);

    // The real failure was an arm that did not move at all, and the one before
    // that was two arms moving opposite ways.
    expect(armAngle(rig, 'Left')).toBeGreaterThan(40);
    expect(armAngle(rig, 'Right')).toBeGreaterThan(40);
  });

  it.each(models)('does not fold %s past vertical', (file) => {
    const rig = loadRig(file);
    applyGlbRestPose(rig);

    expect(armAngle(rig, 'Left')).toBeLessThan(85);
    expect(armAngle(rig, 'Right')).toBeLessThan(85);
  });

  it('barely touches an avatar that already hangs naturally', () => {
    // anne starts at ~55°, so there is only a few degrees to make up. The
    // failure to guard against is a correction that fires anyway and swings
    // the arm somewhere else entirely.
    const rig = loadRig('anne.glb');
    const before = armAngle(rig, 'Left');
    expect(before).toBeGreaterThan(45);

    applyGlbRestPose(rig);
    const after = armAngle(rig, 'Left');

    expect(Math.abs(after - before)).toBeLessThan(10);
    expect(after).toBeGreaterThan(before);
  });

  it('keeps both arms symmetrical', () => {
    const rig = loadRig('max.glb');
    applyGlbRestPose(rig);

    expect(Math.abs(armAngle(rig, 'Left') - armAngle(rig, 'Right'))).toBeLessThan(0.5);
  });

  it('is stable when applied twice', () => {
    // Belt and braces: a reload should not keep bending the arms further.
    const rig = loadRig('max.glb');
    applyGlbRestPose(rig);
    const once = armAngle(rig, 'Left');
    applyGlbRestPose(rig);

    expect(armAngle(rig, 'Left')).toBeCloseTo(once, 3);
  });

  it('does nothing, rather than throwing, when the bones are missing', () => {
    const bare = new FakeObject3D();
    expect(() => applyGlbRestPose(bare)).not.toThrow();
    expect(() => applyGlbRestPose(null)).not.toThrow();
    expect(() => lowerArm(null, null, null)).not.toThrow();
  });
});

describe('posing whatever was loaded', () => {
  it('poses a GLB, which the renderer used to skip entirely', () => {
    // The bug: the stage posed VRMs and left every GLB standing with its arms
    // out. Most of the avatar library is GLB, so most avatars were scarecrows.
    const rig = loadRig('max.glb');
    expect(armAngle(rig, 'Left')).toBeLessThan(10);

    applyRestPose({ scene: rig }, null);

    expect(armAngle(rig, 'Left')).toBeGreaterThan(45);
    expect(armAngle(rig, 'Right')).toBeGreaterThan(45);
  });

  it('accepts a bare scene as readily as a gltf', () => {
    const rig = loadRig('max.glb');
    applyRestPose(rig, null);
    expect(armAngle(rig, 'Left')).toBeGreaterThan(45);
  });

  it('leaves a GLB alone when a vrm was supplied', () => {
    // A VRM poses through its humanoid bones instead; posing the raw scene as
    // well would apply the correction twice.
    const rig = loadRig('max.glb');
    const before = armAngle(rig, 'Left');
    applyRestPose({ scene: rig }, { humanoid: null });

    expect(armAngle(rig, 'Left')).toBeCloseTo(before, 5);
  });

  it('does nothing, rather than throwing, with nothing to pose', () => {
    expect(() => applyRestPose(null, null)).not.toThrow();
    expect(() => applyRestPose(undefined, undefined)).not.toThrow();
  });
});
