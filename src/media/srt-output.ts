import ffmpeg from 'fluent-ffmpeg';
import { PassThrough } from 'stream';
import { MediaOutput } from './types.js';

export interface SRTOutputConfig {
  port?: number;           // default 9000
  ffmpegPath?: string;
  latencyMs?: number;      // SRT latency, default 120
}

export class SRTOutput implements MediaOutput {
  readonly name = 'srt';
  private config: SRTOutputConfig;
  private frameStream: PassThrough | null = null;
  private command: ReturnType<typeof ffmpeg> | null = null;
  private _isRunning = false;
  private _width = 0;
  private _height = 0;
  private _fps = 25;

  constructor(config: SRTOutputConfig = {}) {
    this.config = config;
    if (config.ffmpegPath) ffmpeg.setFfmpegPath(config.ffmpegPath);
  }

  start(): void { /* deferred until first frame — need dimensions */ }

  private startWithDimensions(width: number, height: number, fps: number): void {
    if (this._isRunning) return;
    this._width = width;
    this._height = height;
    this._fps = fps;

    const port = this.config.port ?? 9000;
    const latency = (this.config.latencyMs ?? 120) * 1000; // SRT latency in microseconds

    this.frameStream = new PassThrough();

    this.command = ffmpeg()
      .input(this.frameStream)
      .inputFormat('rawvideo')
      .inputOptions([
        `-pixel_format rgba`,
        `-video_size ${width}x${height}`,
        `-framerate ${fps}`,
      ])
      .videoCodec('libx264')
      .outputOptions([
        `-preset ultrafast`,
        `-tune zerolatency`,
        `-g ${fps}`,
        `-pix_fmt yuv420p`,
        `-f mpegts`,
      ])
      .output(`srt://0.0.0.0:${port}?mode=listener&transtype=live&latency=${latency}`)
      .on('start', (cmd: string) => {
        console.log(`[SRT] Listening on srt://localhost:${port}`);
        console.log(`[SRT] OBS: add Media Source with URL srt://localhost:${port}`);
      })
      .on('error', (err: Error) => {
        if (!err.message.includes('End of file')) {
          console.error('[SRT] FFmpeg error:', err.message);
        }
      });

    this.command.run();
    this._isRunning = true;
  }

  pushFrame(rgbaBuffer: Buffer, width: number, height: number, fps: number): void {
    if (!this._isRunning) {
      this.startWithDimensions(width, height, fps);
    }
    this.frameStream?.write(rgbaBuffer);
  }

  stop(): void {
    if (!this._isRunning) return;
    this.frameStream?.end();
    this.frameStream = null;
    this.command = null;
    this._isRunning = false;
  }

  get isRunning(): boolean { return this._isRunning; }
  get port(): number { return this.config.port ?? 9000; }
}
