/**
 * Client for the HATS Speech Service.
 *
 * `synthesise` streams: the service emits one JSON object per line as each
 * sentence finishes rendering, and this hands each to `onChunk` immediately.
 * That preserves the property the runner depends on — audio and lip movement
 * begin on the first sentence, not when the whole utterance is done.
 */

import type { SpeechChunk, Voice } from '../../speech-core/src/types.js';

const BASE = '/api/v1';

export class SpeechClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, timeoutMs = 120_000) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
  }

  get url(): string { return this.baseUrl; }

  /** True when the service answers and has at least one voice ready. */
  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}${BASE}/health`, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return false;
      const health = await res.json() as { speechAvailable?: boolean };
      return health.speechAvailable === true;
    } catch {
      return false;
    }
  }

  async voices(): Promise<Voice[]> {
    try {
      const res = await fetch(`${this.baseUrl}${BASE}/voices`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return [];
      const body = await res.json() as { voices?: Voice[] };
      return body.voices ?? [];
    } catch {
      return [];
    }
  }

  /**
   * Render `text` and deliver each sentence as it completes.
   * Resolves when the utterance is finished; never throws for an unreachable
   * service, since speech is an enhancement and must not break a reply.
   */
  async synthesise(
    request: { text: string; voice?: string | undefined; speakerName?: string | undefined; agentName?: string },
    onChunk: (chunk: SpeechChunk) => void,
  ): Promise<void> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${BASE}/speech`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      return;   // service down — the agent still replies, just silently
    }
    if (!res.ok || !res.body) return;

    // NDJSON: complete lines are chunks; a partial tail waits for more bytes.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) emit(line, onChunk);
      }
    }
    const tail = buffer.trim();
    if (tail) emit(tail, onChunk);
  }

  /** A short sample as WAV bytes, for a voice picker. */
  async preview(voice: string, speakerName?: string): Promise<Buffer | null> {
    try {
      const res = await fetch(`${this.baseUrl}${BASE}/speech/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice, speakerName }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    } catch {
      return null;
    }
  }
}

function emit(line: string, onChunk: (chunk: SpeechChunk) => void): void {
  try {
    const parsed = JSON.parse(line) as SpeechChunk & { error?: string };
    // The service reports a mid-stream failure in-band rather than by status.
    if (parsed.error) return;
    onChunk(parsed);
  } catch {
    /* a malformed line is skipped rather than killing the utterance */
  }
}
