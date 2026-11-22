import { VisemeEvent, getVisemeAt } from '../lipsync/scheduler.js';
import { CanvasRenderer } from './canvas-renderer.js';
import { GlbRenderer } from './glb-renderer.js';

export type FrameCallback = (frameBuffer: Buffer, frameIndex: number) => void;

/** Any renderer that supports the setViseme / renderFrame interface */
type AnyRenderer = CanvasRenderer | GlbRenderer;

export class FrameClock {
  private renderer: AnyRenderer;
  private timeline: VisemeEvent[];
  private onFrame: FrameCallback;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private frameIndex = 0;
  private startTime = 0;

  constructor(renderer: AnyRenderer, timeline: VisemeEvent[], onFrame: FrameCallback) {
    this.renderer = renderer;
    this.timeline = timeline;
    this.onFrame = onFrame;
  }

  start(): void {
    this.startTime = Date.now();
    this.frameIndex = 0;
    const intervalMs = 1000 / this.renderer.fps;

    this.intervalHandle = setInterval(() => {
      const elapsed = Date.now() - this.startTime;
      const viseme = getVisemeAt(this.timeline, elapsed);
      this.renderer.setViseme(viseme);
      const frame = this.renderer.renderFrame();
      this.onFrame(frame, this.frameIndex++);
    }, intervalMs);
  }

  stop(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    // Return to rest pose
    this.renderer.setViseme('rest');
  }

  get isRunning(): boolean {
    return this.intervalHandle !== null;
  }
}
