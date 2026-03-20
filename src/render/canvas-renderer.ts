import { createCanvas, loadImage, Canvas, Image } from '@napi-rs/canvas';
import * as fs from 'fs/promises';
import { AvatarAssets, EyeBounds, VisemeId } from '../avatar/types.js';
import { IdleAnimator, IdleState } from './idle-animator.js';

export interface RendererConfig {
  width: number;
  height: number;
  fps: number;
}

export type FrameCallback = (frame: Buffer, index: number) => void;

export class CanvasRenderer {
  private canvas: Canvas;
  private ctx: ReturnType<Canvas['getContext']>;
  private images: Map<VisemeId | 'base', Image> = new Map();
  private config: RendererConfig;
  private currentViseme: VisemeId = 'rest';
  private eyeBounds: EyeBounds | null = null;
  private idleAnimator: IdleAnimator = new IdleAnimator();

  constructor(config: RendererConfig = { width: 512, height: 512, fps: 25 }) {
    this.config = config;
    this.canvas = createCanvas(config.width, config.height);
    this.ctx = this.canvas.getContext('2d');
  }

  async loadAssets(assets: AvatarAssets): Promise<void> {
    const load = async (key: VisemeId | 'base', filePath: string) => {
      const data = await fs.readFile(filePath);
      const img = await loadImage(data);
      this.images.set(key, img);
    };

    await load('base', assets.baseImagePath);
    for (const [visemeId, imagePath] of Object.entries(assets.visemeFrames)) {
      await load(visemeId as VisemeId, imagePath);
    }

    this.eyeBounds = assets.eyeBounds ?? null;
  }

  setViseme(visemeId: VisemeId): void {
    this.currentViseme = visemeId;
  }

  resetIdle(): void {
    this.idleAnimator.reset();
  }

  renderFrame(): Buffer {
    const idle = this.idleAnimator.tick();
    this.drawWithIdle(idle);
    const imageData = this.ctx.getImageData(0, 0, this.config.width, this.config.height);
    return Buffer.from(imageData.data.buffer);
  }

  renderJpegFrame(quality = 85): Buffer {
    const idle = this.idleAnimator.tick();
    this.drawWithIdle(idle);
    return this.canvas.toBuffer('image/jpeg', { quality: quality / 100 });
  }

  private drawWithIdle(idle: IdleState): void {
    const { width, height } = this.config;
    const img = this.images.get(this.currentViseme) ?? this.images.get('rest') ?? this.images.get('base');

    this.ctx.clearRect(0, 0, width, height);
    this.ctx.save();

    // Apply idle transforms: scale around centre, then drift
    this.ctx.translate(width / 2 + idle.dx, height / 2 + idle.dy);
    this.ctx.scale(idle.scale, idle.scale);
    this.ctx.translate(-width / 2, -height / 2);

    if (img) {
      this.ctx.drawImage(img, 0, 0, width, height);
    } else {
      this.ctx.fillStyle = '#888';
      this.ctx.fillRect(0, 0, width, height);
    }

    // Blink overlay — skin-toned rectangle descending from top of each eye
    if (idle.blinkProgress > 0 && this.eyeBounds) {
      this.drawBlink(idle.blinkProgress);
    }

    this.ctx.restore();
  }

  private drawBlink(progress: number): void {
    if (!this.eyeBounds) return;
    // Draw an eyelid that sweeps down over each eye
    this.ctx.fillStyle = 'rgba(180, 140, 110, 0.92)'; // approximate skin tone

    for (const eye of [this.eyeBounds.left, this.eyeBounds.right]) {
      const lidHeight = eye.height * progress;
      // Slightly rounded bottom edge on the lid
      this.ctx.beginPath();
      this.ctx.roundRect(eye.x, eye.y, eye.width, lidHeight, [0, 0, 4, 4]);
      this.ctx.fill();
    }
  }

  get width(): number { return this.config.width; }
  get height(): number { return this.config.height; }
  get fps(): number { return this.config.fps; }
}
