import ffmpeg from 'fluent-ffmpeg';
import { PassThrough } from 'stream';

export interface OBSOutputConfig {
  width: number;
  height: number;
  fps: number;
  /** DirectShow device name — default is OBS Virtual Camera */
  deviceName?: string;
  /** FFmpeg binary path if not on PATH */
  ffmpegPath?: string;
}

export class OBSOutput {
  private config: OBSOutputConfig;
  private frameStream: PassThrough | null = null;
  private command: ReturnType<typeof ffmpeg> | null = null;
  private _isRunning = false;

  constructor(config: OBSOutputConfig) {
    this.config = config;
    if (config.ffmpegPath) ffmpeg.setFfmpegPath(config.ffmpegPath);
  }

  start(): void {
    if (this._isRunning) return;

    this.frameStream = new PassThrough();
    const deviceName = this.config.deviceName ?? 'OBS Virtual Camera';

    this.command = ffmpeg()
      .input(this.frameStream)
      .inputFormat('rawvideo')
      .inputOptions([
        `-pixel_format rgba`,
        `-video_size ${this.config.width}x${this.config.height}`,
        `-framerate ${this.config.fps}`,
      ])
      .outputFormat('dshow')
      .output(`video=${deviceName}`)
      .outputOptions(['-pix_fmt yuv420p'])
      .on('error', (err: Error) => {
        // Only log unexpected errors — stream end is normal
        if (!err.message.includes('pipe:0: End of file')) {
          console.error('[OBSOutput] FFmpeg error:', err.message);
        }
      });

    this.command.run();
    this._isRunning = true;
  }

  pushFrame(rawRGBABuffer: Buffer): void {
    if (!this._isRunning || !this.frameStream) return;
    this.frameStream.write(rawRGBABuffer);
  }

  stop(): void {
    if (!this._isRunning) return;
    this.frameStream?.end();
    this.frameStream = null;
    this.command = null;
    this._isRunning = false;
  }

  get isRunning(): boolean {
    return this._isRunning;
  }
}
