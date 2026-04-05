import * as THREE from 'three';
import { log } from '../util/logger.js';
import createGl from 'gl';
import * as fs from 'fs/promises';
import { loadImage } from '@napi-rs/canvas';

export interface HeadlessRendererConfig {
  width: number;
  height: number;
}

export class HeadlessRenderer {
  private glContext: WebGLRenderingContext;
  private renderer: THREE.WebGLRenderer;
  readonly width: number;
  readonly height: number;

  constructor(config: HeadlessRendererConfig) {
    this.width = config.width;
    this.height = config.height;

    // Create headless WebGL context
    this.glContext = createGl(config.width, config.height, {
      preserveDrawingBuffer: true,
      antialias: true,
      depth: true,
    });

    // Polyfill globals Three.js may reference
    if (typeof (globalThis as any).self === 'undefined') {
      (globalThis as any).self = globalThis;
    }

    // headless-gl only provides WebGL 1. Remove WebGL2RenderingContext from global
    // so Three.js isWebGL2 detection returns false and stays on WebGL 1 code paths.
    delete (globalThis as any).WebGL2RenderingContext;

    // Create a fake canvas for Three.js
    const fakeCanvas = {
      width: config.width,
      height: config.height,
      style: { width: `${config.width}px`, height: `${config.height}px` },
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
      // Return null for webgl2 — forces Three.js to fall back to WebGL 1
      getContext: (type: string) => (type === 'webgl2' ? null : this.glContext),
    };

    this.renderer = new THREE.WebGLRenderer({
      canvas: fakeCanvas as unknown as HTMLCanvasElement,
      context: this.glContext as unknown as WebGLRenderingContext,
      antialias: true,
      alpha: false,
    });

    this.renderer.setSize(config.width, config.height, false);
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = false;
  }

  render(scene: THREE.Scene, camera: THREE.Camera): Buffer {
    this.renderer.render(scene, camera);

    // Read pixels from headless context (bottom-left origin in OpenGL)
    const raw = new Uint8Array(this.width * this.height * 4);
    this.glContext.readPixels(
      0, 0, this.width, this.height,
      this.glContext.RGBA,
      this.glContext.UNSIGNED_BYTE,
      raw,
    );

    // Flip vertically (OpenGL is bottom-left, we need top-left)
    return flipVertically(raw, this.width, this.height);
  }

  /** Load an image file and create a Three.js DataTexture */
  async loadTexture(imagePath: string): Promise<THREE.DataTexture> {
    const data = await fs.readFile(imagePath);
    const img = await loadImage(data);
    log.info(`[Texture] Loaded ${imagePath} — ${img.width}x${img.height}`);

    // Use @napi-rs/canvas to decode to raw RGBA
    const { createCanvas } = await import('@napi-rs/canvas');
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, img.width, img.height);

    // Flip rows manually — UNPACK_FLIP_Y_WEBGL is unreliable in headless-gl,
    // and SRGBColorSpace triggers a shader conversion path that breaks in WebGL 1.
    const flipped = flipRGBA(new Uint8Array(imageData.data.buffer), img.width, img.height);

    const texture = new THREE.DataTexture(
      flipped,
      img.width,
      img.height,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    texture.flipY = false; // already flipped above
    texture.needsUpdate = true;
    return texture;
  }

  get threeRenderer(): THREE.WebGLRenderer {
    return this.renderer;
  }

  dispose(): void {
    // Stub cancelAnimationFrame before dispose — Three.js cleanup calls it on null context
    if (typeof (globalThis as any).cancelAnimationFrame === 'undefined') {
      (globalThis as any).cancelAnimationFrame = () => {};
    }
    this.renderer.dispose();
  }
}

function flipRGBA(src: Uint8Array, width: number, height: number): Uint8Array {
  const dst = new Uint8Array(src.length);
  const rowBytes = width * 4;
  for (let y = 0; y < height; y++) {
    const srcOffset = (height - 1 - y) * rowBytes;
    const dstOffset = y * rowBytes;
    dst.set(src.subarray(srcOffset, srcOffset + rowBytes), dstOffset);
  }
  return dst;
}

function flipVertically(src: Uint8Array, width: number, height: number): Buffer {
  const dst = Buffer.allocUnsafe(src.length);
  const rowBytes = width * 4;
  for (let y = 0; y < height; y++) {
    const srcOffset = (height - 1 - y) * rowBytes;
    const dstOffset = y * rowBytes;
    dst.set(src.subarray(srcOffset, srcOffset + rowBytes), dstOffset);
  }
  return dst;
}
