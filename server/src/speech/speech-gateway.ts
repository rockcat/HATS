/**
 * The runner's view of speech.
 *
 * Synthesis lives in the Speech Service — it spawns a TTS server per voice, and
 * only one process can own that. This wraps the client so the rest of the
 * runner keeps a small, synchronous-feeling surface: ask for the voices, ask
 * whether speech is possible, ask for an utterance.
 *
 * Speech is an enhancement. Every method degrades to "no audio" rather than
 * failing a reply, so a runner with no Speech Service still works — the agents
 * simply do not speak.
 */

import { SpeechClient } from '../../../packages/clients/src/speech-client.js';
import type { SpeechChunk, Voice } from '../../../packages/speech-core/src/types.js';
import { log } from '../../../packages/core/src/logger.js';

const REFRESH_MS = 60_000;

export class SpeechGateway {
  private readonly client: SpeechClient;
  private voices: Voice[] = [];
  private available = false;
  private lastRefresh = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(serviceUrl: string) {
    this.client = new SpeechClient(serviceUrl);
  }

  get serviceUrl(): string { return this.client.url; }

  /** Probe once at startup, then keep the voice list warm. */
  async start(): Promise<void> {
    await this.refresh();
    if (this.available) {
      log.info(`[Speech] ${this.voices.length} voice(s) via ${this.client.url}: ${this.voices.map((v) => v.name).join(', ')}`);
    } else {
      log.info(`[Speech] no Speech Service at ${this.client.url} — agents will not speak`);
    }
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  private async refresh(): Promise<void> {
    this.available = await this.client.isAvailable();
    this.voices = this.available ? await this.client.voices() : [];
    this.lastRefresh = Date.now();
  }

  /** Cached voice list; empty when no service or no models. */
  getVoices(): Voice[] { return this.voices; }

  isAvailable(): boolean { return this.available; }

  /** Resolve a preferred voice name against what the service actually has. */
  resolveVoice(preferred: string | undefined): Voice | undefined {
    if (this.voices.length === 0) return undefined;
    if (preferred) {
      const match = this.voices.find((v) => v.name === preferred);
      if (match) return match;
    }
    return this.voices[0];
  }

  /**
   * Speak `text` as `agentName`, delivering each sentence to `onChunk` as it
   * is rendered so playback and lip movement can start immediately.
   */
  async speak(
    text: string,
    agentName: string,
    voiceName: string | undefined,
    speakerName: string | undefined,
    onChunk: (chunk: SpeechChunk) => void,
  ): Promise<void> {
    if (!this.available && Date.now() - this.lastRefresh > REFRESH_MS) await this.refresh();
    if (!this.available) return;
    await this.client.synthesise({ text, agentName, voice: voiceName, speakerName }, onChunk);
  }

  /** A short sample for a voice picker. Null when unavailable. */
  preview(voice: string, speakerName?: string): Promise<Buffer | null> {
    return this.client.preview(voice, speakerName);
  }
}
