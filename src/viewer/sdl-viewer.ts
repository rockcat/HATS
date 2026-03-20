import sdl from '@kmamal/sdl';
import { MediaOutput } from '../media/types.js';

export interface SDLViewerConfig {
  title?: string;
  width?: number;
  height?: number;
  /** Called when the user closes the window or presses Escape */
  onClose?: () => void;
  /** Called on left-button drag with pixel deltas */
  onMouseDrag?: (dx: number, dy: number) => void;
}

export class SDLViewer implements MediaOutput {
  readonly name = 'sdl';
  private window: ReturnType<typeof sdl.video.createWindow> | null = null;
  private config: SDLViewerConfig;
  private _isRunning = false;
  private renderPending = false;
  private mouseDown = false;

  constructor(config: SDLViewerConfig = {}) {
    this.config = config;
  }

  start(): void {
    if (this._isRunning) return;

    this.window = sdl.video.createWindow({
      title: this.config.title ?? 'Personality',
      width: this.config.width ?? 512,
      height: this.config.height ?? 512,
      resizable: false,
    });

    this.window.on('close', () => this.handleClose());

    this.window.on('keyDown', ({ scancode }: { scancode: string }) => {
      if (scancode === 'escape') this.handleClose();
    });

    this.window.on('mouseButtonDown', ({ button }: { button: number }) => {
      if (button === 1) this.mouseDown = true;
    });

    this.window.on('mouseButtonUp', ({ button }: { button: number }) => {
      if (button === 1) this.mouseDown = false;
    });

    this.window.on('mouseMove', ({ dx, dy }: { dx: number; dy: number }) => {
      if (this.mouseDown && this.config.onMouseDrag) {
        this.config.onMouseDrag(dx, dy);
      }
    });

    this._isRunning = true;
    console.log('[SDL] Window open — press Escape or close to stop');
  }

  pushFrame(rgbaBuffer: Buffer, width: number, height: number): void {
    if (!this._isRunning || !this.window || this.window.destroyed) return;

    // Skip frame if previous render hasn't finished — keeps the loop non-blocking
    if (this.renderPending) return;

    this.renderPending = true;
    const pitch = width * 4; // bytes per row

    const result = this.window.render(width, height, pitch, 'rgba32', rgbaBuffer);
    if (result && typeof (result as any).then === 'function') {
      (result as Promise<void>)
        .then(() => { this.renderPending = false; })
        .catch(() => { this.renderPending = false; });
    } else {
      this.renderPending = false;
    }
  }

  stop(): void {
    if (!this._isRunning) return;
    this._isRunning = false;
    try {
      this.window?.destroyGently();
    } catch { /* already destroyed */ }
    this.window = null;
  }

  get isRunning(): boolean { return this._isRunning; }

  private handleClose(): void {
    this.stop();
    this.config.onClose?.();
  }
}
