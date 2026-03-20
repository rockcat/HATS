import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { AvatarAssets } from '../avatar/types.js';
import { TTSProvider } from '../tts/types.js';
import { buildVisemeTimeline } from './scheduler.js';
import { CanvasRenderer } from '../render/canvas-renderer.js';
import { FrameClock } from '../render/frame-clock.js';
import { OBSOutput } from '../webcam/obs-output.js';

export type FrameFormat = 'raw' | 'jpeg';

export interface LipsyncSessionConfig {
  assets: AvatarAssets;
  tts: TTSProvider;
  renderWidth?: number;
  renderHeight?: number;
  fps?: number;
  obsOutput?: OBSOutput;
  /** Called for every rendered frame. Format controlled by frameFormat. */
  onFrame?: (frame: Buffer, index: number) => void;
  frameFormat?: FrameFormat;
  /** Path to ffplay binary. Defaults to 'ffplay' on PATH. Set to '' to disable audio. */
  ffplayPath?: string;
}

export class LipsyncSession {
  private renderer: CanvasRenderer;
  private tts: TTSProvider;
  private assets: AvatarAssets;
  private obsOutput?: OBSOutput;
  private onFrame?: (frame: Buffer, index: number) => void;
  private frameFormat: FrameFormat;
  private ffplayPath: string;
  private assetsLoaded = false;

  constructor(config: LipsyncSessionConfig) {
    this.assets = config.assets;
    this.tts = config.tts;
    this.obsOutput = config.obsOutput;
    this.onFrame = config.onFrame;
    this.frameFormat = config.frameFormat ?? 'raw';
    this.ffplayPath = config.ffplayPath ?? 'ffplay';
    this.renderer = new CanvasRenderer({
      width: config.renderWidth ?? 512,
      height: config.renderHeight ?? 512,
      fps: config.fps ?? 25,
    });
  }

  async init(): Promise<void> {
    if (this.assetsLoaded) return;
    await this.renderer.loadAssets(this.assets);
    this.assetsLoaded = true;
    this.obsOutput?.start();
  }

  /**
   * Speak text: synthesise audio + build viseme timeline in parallel,
   * then play audio via ffplay while driving the frame clock.
   * Returns when speech is complete.
   */
  async speak(text: string): Promise<void> {
    if (!this.assetsLoaded) await this.init();

    // TTS + phoneme analysis in parallel
    const [ttsResult] = await Promise.all([
      this.tts.synthesise({ text }),
      buildVisemeTimeline(text), // warm the CMU dict cache
    ]);

    const timeline = await buildVisemeTimeline(text, ttsResult.durationMs);

    // Save audio to temp file for ffplay
    const tmpAudio = path.join(os.tmpdir(), `lipsync-${Date.now()}.mp3`);
    await fs.writeFile(tmpAudio, ttsResult.audioBuffer);

    return new Promise<void>((resolve) => {
      // Start audio playback
      if (this.ffplayPath) {
        const player = spawn(
          this.ffplayPath,
          ['-nodisp', '-autoexit', '-loglevel', 'quiet', tmpAudio],
          { stdio: 'ignore' },
        );
        player.on('error', () => { /* ffplay not available — silent */ });
      }

      // Drive frame clock
      const clock = new FrameClock(this.renderer, timeline, (frame, index) => {
        if (this.onFrame) {
          const buf = this.frameFormat === 'jpeg'
            ? this.renderer.renderJpegFrame()
            : frame;
          this.onFrame(buf, index);
        }
        this.obsOutput?.pushFrame(frame);
      });

      clock.start();

      setTimeout(async () => {
        clock.stop();
        await fs.unlink(tmpAudio).catch(() => { /* ignore */ });
        resolve();
      }, ttsResult.durationMs + 300);
    });
  }

  stop(): void {
    this.obsOutput?.stop();
  }
}
