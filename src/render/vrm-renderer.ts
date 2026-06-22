// vrm-renderer.ts — Server-side VRM avatar renderer.
// Uses @pixiv/three-vrm for loading + expression management.
// Provides the same setViseme/renderFrame/renderJpegFrame API as GlbRenderer.

import * as THREE from 'three';
import * as fs from 'fs/promises';
import { HeadlessRenderer } from '../renderer3d/headless-renderer.js';
import { RendererConfig } from './canvas-renderer.js';
import { VisemeId } from '../avatar/types.js';
import type { VRM } from '@pixiv/three-vrm';

// ── Viseme → VRM expression weights ──────────────────────────────────────────
// VRM standard vowel expressions: aa, ih, ou, ee, oh

type VowelWeights = { aa?: number; ih?: number; ou?: number; ee?: number; oh?: number };

const VISEME_TO_VRM: Record<string, VowelWeights> = {
  rest: {},
  AI:   { aa: 1.0 },
  E:    { ee: 1.0 },
  O:    { oh: 1.0 },
  U:    { ou: 1.0 },
  WQ:   { ou: 0.8 },
  MBP:  {},                        // closed mouth
  FV:   { ih: 0.7 },
  LDN:  { ih: 0.4, aa: 0.2 },
  SZ:   { ih: 0.5 },
};

const VOWELS = ['aa', 'ih', 'ou', 'ee', 'oh'] as const;
type Vowel = typeof VOWELS[number];

// ── VrmRenderer ───────────────────────────────────────────────────────────────

export class VrmRenderer {
  private hlRenderer: HeadlessRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private vrm: VRM | null = null;
  private clock = new THREE.Clock();
  private config: RendererConfig;

  // Lipsync
  private currentViseme: VisemeId = 'rest';
  private liveWeights: Partial<Record<Vowel, number>> = {};

  // Blink idle
  private blinkTimer = 0;
  private nextBlink = 2 + Math.random() * 3;
  private blinkPhase: 'open' | 'closing' | 'opening' = 'open';
  private blinkT = 0;
  private readonly BLINK_HALF = 0.07; // seconds for each half (close / open)

  constructor(config: RendererConfig = { width: 512, height: 512, fps: 25 }) {
    this.config = config;
    this.hlRenderer = new HeadlessRenderer({ width: config.width, height: config.height });

    this.scene = new THREE.Scene();
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(1, 2, 2);
    this.scene.add(dir);
    const fill = new THREE.DirectionalLight(0xffffff, 0.3);
    fill.position.set(-1, 0, 1);
    this.scene.add(fill);

    this.camera = new THREE.PerspectiveCamera(50, config.width / config.height, 0.1, 100);
  }

  async loadAvatar(
    vrmPath: string,
    camPos: [number, number, number],
    rotate?: [number, number, number],
    fov = 50,
    scale?: number,
  ): Promise<void> {
    const { GLTFLoader }     = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const { VRMLoaderPlugin } = await import('@pixiv/three-vrm');

    const fileData = await fs.readFile(vrmPath);
    const arrayBuffer = fileData.buffer.slice(
      fileData.byteOffset, fileData.byteOffset + fileData.byteLength,
    ) as ArrayBuffer;

    const loader = new GLTFLoader();
    loader.register(parser => new VRMLoaderPlugin(parser));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gltf = await new Promise<any>((resolve, reject) => {
      loader.parse(arrayBuffer, '', resolve, reject);
    });

    // Remove previous avatar (keep lights)
    for (const c of this.scene.children.filter(c => !(c instanceof THREE.Light))) {
      this.scene.remove(c);
    }

    this.vrm = gltf.userData.vrm as VRM ?? null;

    if (rotate) {
      const D = Math.PI / 180;
      gltf.scene.rotation.set(rotate[0] * D, rotate[1] * D, rotate[2] * D);
    }
    if (scale != null) gltf.scene.scale.setScalar(scale);

    this.camera.fov = fov;
    this.camera.aspect = this.config.width / this.config.height;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(...camPos);
    this.camera.lookAt(new THREE.Vector3(camPos[0], camPos[1] - 0.08, 0));

    this.scene.add(gltf.scene);
    this.liveWeights = {};
    this.clock.getDelta(); // reset
  }

  setViseme(visemeId: VisemeId): void {
    this.currentViseme = visemeId;
  }

  resetIdle(): void {
    this.liveWeights = {};
    this.clock.getDelta();
  }

  renderFrame(): Buffer {
    const delta = this.clock.getDelta();
    this._stepLipsync();
    this._stepBlink(delta);
    this.vrm?.update(delta); // spring bones + expression flush
    return this.hlRenderer.render(this.scene, this.camera);
  }

  async renderJpegFrame(quality = 85): Promise<Buffer> {
    return this._encodeJpeg(this.renderFrame(), quality);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private _stepLipsync(): void {
    const em = this.vrm?.expressionManager;
    if (!em) return;

    const target = VISEME_TO_VRM[this.currentViseme] ?? {};
    const SPEED  = 0.35;

    for (const v of VOWELS) {
      const t    = (target as Record<string, number>)[v] ?? 0;
      const cur  = this.liveWeights[v] ?? 0;
      const next = cur + (t - cur) * SPEED;
      this.liveWeights[v] = next;
      em.setValue(v, next);
    }
    // expressionManager.update() is called inside vrm.update() — no need here
  }

  private _stepBlink(delta: number): void {
    const em = this.vrm?.expressionManager;
    if (!em) return;

    if (this.blinkPhase === 'open') {
      this.blinkTimer += delta;
      if (this.blinkTimer >= this.nextBlink) {
        this.blinkPhase = 'closing';
        this.blinkT     = 0;
        this.blinkTimer = 0;
        this.nextBlink  = 2 + Math.random() * 4;
      }
    } else {
      this.blinkT += delta / this.BLINK_HALF;
      const progress = Math.min(this.blinkT, 1);
      const weight   = this.blinkPhase === 'closing' ? progress : 1 - progress;
      em.setValue('blink', weight);
      if (progress >= 1) {
        if (this.blinkPhase === 'closing') { this.blinkPhase = 'opening'; this.blinkT = 0; }
        else                               { this.blinkPhase = 'open'; }
      }
    }
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

  get width(): number  { return this.config.width; }
  get height(): number { return this.config.height; }
  get fps(): number    { return this.config.fps; }

  dispose(): void { this.hlRenderer.dispose(); }
}
