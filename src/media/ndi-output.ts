import { MediaOutput } from './types.js';
import { log } from '../util/logger.js';

export class NDIOutput implements MediaOutput {
  readonly name = 'ndi';
  private sender: any = null;
  private _isRunning = false;
  private sourceName: string;

  constructor(sourceName = 'Personality Agent') {
    this.sourceName = sourceName;
  }

  start(): void {
    if (this._isRunning) return;
    try {
      // Dynamic import so the module loads even if grandiose native build fails
      const grandiose = require('grandiose') as any;
      this.sender = grandiose.send({
        name: this.sourceName,
        clockVideo: true,
        clockAudio: false,
      });
      this._isRunning = true;
      log.info(`[NDI] Sending as "${this.sourceName}"`);
    } catch (err) {
      log.warn('[NDI] grandiose unavailable — NDI output disabled:', (err as Error).message);
    }
  }

  pushFrame(rgbaBuffer: Buffer, width: number, height: number, fps: number): void {
    if (!this._isRunning || !this.sender) return;
    try {
      // fourCC for RGBA
      const fourCC = Buffer.from('RGBA').readUInt32BE(0);
      this.sender.video({
        xres: width,
        yres: height,
        frameRateN: fps * 1000,
        frameRateD: 1000,
        pictureAspectRatio: width / height,
        fourCC,
        lineStrideInBytes: width * 4,
        data: rgbaBuffer,
      });
    } catch {
      // Drop frame on error — don't interrupt the render loop
    }
  }

  stop(): void {
    if (!this._isRunning) return;
    try { this.sender?.destroy?.(); } catch { /* ignore */ }
    this.sender = null;
    this._isRunning = false;
  }

  get isRunning(): boolean { return this._isRunning; }
}
