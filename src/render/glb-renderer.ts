// glb-renderer.ts — Server-side GLB avatar renderer using headless-gl + Three.js.
// Shares morph animation logic with the browser via morph-lipsync.js.
// Drop-in replacement for CanvasRenderer: same setViseme/renderFrame/renderJpegFrame API.

import * as THREE from 'three';
import * as fs from 'fs/promises';
import * as path from 'path';
import { HeadlessRenderer } from '../renderer3d/headless-renderer.js';
import { RendererConfig } from './canvas-renderer.js';
import { VisemeId } from '../avatar/types.js';

// Shared morph helpers — same module imported by browser avatar.js and meeting.js
import {
  collectVisemeMeshes,
  stepMorphWeights,
  applyMorphWeights,
} from '../webui/public/morph-lipsync.js';

// ── VisemeId → ARKit viseme_* morph name ──────────────────────────────────────

const VISEME_TO_MORPH: Record<string, string> = {
  rest: 'viseme_sil',
  AI:   'viseme_aa',
  E:    'viseme_E',
  O:    'viseme_O',
  U:    'viseme_U',
  MBP:  'viseme_PP',
  FV:   'viseme_FF',
  LDN:  'viseme_nn',
  WQ:   'viseme_OO',
  SZ:   'viseme_SS',
};

// ── Avatar catalogue entry (mirrors avatars/avatars.json) ─────────────────────

export interface GlbAvatarConfig {
  /** Absolute path to the .glb file */
  glbPath: string;
  /** [x, y, z] camera position */
  camera: [number, number, number];
  /** [x, y, z] scene rotation in degrees */
  rotate?: [number, number, number];
  /** Camera field-of-view (degrees) */
  fov?: number;
  /** Uniform scale applied to scene */
  scale?: number;
}

// ── GlbRenderer ───────────────────────────────────────────────────────────────

export class GlbRenderer {
  private hlRenderer: HeadlessRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private visemeMeshes: object[] = [];
  private morphWeights: Record<string, number> = {};
  private currentViseme: VisemeId = 'rest';
  private mixer: THREE.AnimationMixer | null = null;
  private clock = new THREE.Clock();
  private config: RendererConfig;

  constructor(config: RendererConfig = { width: 512, height: 512, fps: 25 }) {
    this.config = config;
    this.hlRenderer = new HeadlessRenderer({ width: config.width, height: config.height });

    this.scene = new THREE.Scene();

    // Lighting — matches avatar.js
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(1, 2, 2);
    this.scene.add(dir);
    const fill = new THREE.DirectionalLight(0xffffff, 0.3);
    fill.position.set(-1, 0, 1);
    this.scene.add(fill);

    this.camera = new THREE.PerspectiveCamera(50, config.width / config.height, 0.1, 100);
  }

  /** Load a GLB avatar file and configure camera from the avatar config. */
  async loadAvatar(avatarConfig: GlbAvatarConfig): Promise<void> {
    // Remove old avatar meshes (keep lights)
    const toRemove = this.scene.children.filter(c => !(c instanceof THREE.Light));
    for (const c of toRemove) this.scene.remove(c);
    this.visemeMeshes = [];
    if (this.mixer) { this.mixer.stopAllAction(); this.mixer = null; }
    this.clock.getDelta(); // reset delta accumulator

    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');

    const fileData = await fs.readFile(avatarConfig.glbPath);
    const arrayBuffer = fileData.buffer.slice(
      fileData.byteOffset,
      fileData.byteOffset + fileData.byteLength,
    ) as ArrayBuffer;

    const gltf = await new Promise<any>((resolve, reject) => {
      new GLTFLoader().parse(arrayBuffer, '', resolve, reject);
    });

    const { camera: camPos, rotate, fov, scale } = avatarConfig;

    if (rotate && rotate.length === 3) {
      const DEG = Math.PI / 180;
      gltf.scene.rotation.set(rotate[0] * DEG, rotate[1] * DEG, rotate[2] * DEG);
    }
    if (scale != null) gltf.scene.scale.setScalar(scale);

    this.camera.fov = fov ?? 50;
    this.camera.aspect = this.config.width / this.config.height;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(camPos[0], camPos[1], camPos[2]);
    this.camera.lookAt(new THREE.Vector3(camPos[0], camPos[1] - 0.08, 0));

    this.scene.add(gltf.scene);

    // Collect viseme meshes using shared helper (also hides body geometry)
    this.visemeMeshes = collectVisemeMeshes(gltf.scene);

    // Start idle animations if the GLB has any
    if (gltf.animations?.length > 0) {
      this.mixer = new THREE.AnimationMixer(gltf.scene);
      for (const clip of gltf.animations) {
        this.mixer.clipAction(clip).play();
      }
    }
  }

  /** Set the current phoneme viseme (called each frame by FrameClock). */
  setViseme(visemeId: VisemeId): void {
    this.currentViseme = visemeId;
  }

  resetIdle(): void {
    this.morphWeights = {};
    this.clock.getDelta();
  }

  /** Render one frame and return raw RGBA pixel buffer. */
  renderFrame(): Buffer {
    this._advanceMorphs();
    return this.hlRenderer.render(this.scene, this.camera);
  }

  /** Render one frame and return JPEG-encoded buffer. */
  async renderJpegFrame(quality = 85): Promise<Buffer> {
    const raw = this.renderFrame();
    return this._encodeJpeg(raw, quality);
  }

  private _advanceMorphs(): void {
    const delta = this.clock.getDelta();
    // Advance idle animations first; lipsync writes override mouth tracks
    if (this.mixer) this.mixer.update(delta);
    // Map VisemeId → viseme_* morph key then step weights
    const morphKey = VISEME_TO_MORPH[this.currentViseme] ?? 'viseme_sil';
    stepMorphWeights(this.morphWeights, morphKey);
    applyMorphWeights(this.visemeMeshes, this.morphWeights);
  }

  private async _encodeJpeg(raw: Buffer, quality: number): Promise<Buffer> {
    const { createCanvas } = await import('@napi-rs/canvas');
    const canvas = createCanvas(this.config.width, this.config.height);
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(this.config.width, this.config.height);
    imgData.data.set(raw);
    ctx.putImageData(imgData, 0, 0);
    return canvas.toBuffer('image/jpeg', quality / 100);
  }

  get width(): number  { return this.config.width;  }
  get height(): number { return this.config.height; }
  get fps(): number    { return this.config.fps;    }

  dispose(): void {
    if (this.mixer) { this.mixer.stopAllAction(); this.mixer = null; }
    this.hlRenderer.dispose();
  }
}

// ── Factory: load config from avatars.json by name ───────────────────────────

export async function createGlbRenderer(
  avatarName: string,
  avatarsDir: string,
  rendererConfig?: RendererConfig,
): Promise<GlbRenderer> {
  const cataloguePath = path.join(avatarsDir, 'avatars.json');
  const raw = JSON.parse(await fs.readFile(cataloguePath, 'utf-8'));
  const entry = (raw.avatars as any[]).find(
    a => a.name.toLowerCase() === avatarName.toLowerCase(),
  );
  if (!entry) throw new Error(`Avatar "${avatarName}" not found in avatars.json`);

  const renderer = new GlbRenderer(rendererConfig);
  await renderer.loadAvatar({
    glbPath: path.join(avatarsDir, entry.file),
    camera:  entry.camera,
    rotate:  entry.rotate,
    fov:     entry.fov,
    scale:   entry.scale,
  });
  return renderer;
}
