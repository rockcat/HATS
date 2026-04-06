import { MediaOutput } from './types.js';
import { SRTOutput, SRTOutputConfig } from './srt-output.js';
import { SDLViewer, SDLViewerConfig } from '../viewer/sdl-viewer.js';

export interface MediaServerConfig {
  sourceName?: string;
  srt?: SRTOutputConfig;
  viewer?: SDLViewerConfig;
  enableSRT?: boolean;    // default true
  enableViewer?: boolean; // default true
}

export class MediaServer {
  private outputs: MediaOutput[] = [];

  constructor(config: MediaServerConfig = {}) {
    if (config.enableSRT !== false) {
      this.outputs.push(new SRTOutput(config.srt ?? {}));
    }
    if (config.enableViewer !== false) {
      this.outputs.push(new SDLViewer({
        title: config.sourceName ?? 'Personality',
        ...config.viewer,
      }));
    }
  }

  start(): void {
    for (const output of this.outputs) output.start();
  }

  pushFrame(rgbaBuffer: Buffer, width: number, height: number, fps: number): void {
    for (const output of this.outputs) {
      output.pushFrame(rgbaBuffer, width, height, fps);
    }
  }

  stop(): void {
    for (const output of this.outputs) output.stop();
  }

  get activeOutputs(): string[] {
    return this.outputs.filter((o) => o.isRunning).map((o) => o.name);
  }
}
