/**
 * The Speech Service API.
 *
 * Synthesis streams: one JSON object per line, flushed as each sentence is
 * rendered. That is deliberate — the Team Runner ships each chunk to the
 * browser as it arrives so audio and lip movement start on the first sentence
 * rather than waiting for the whole utterance. Buffering here would put that
 * latency back.
 */

import type { ServerResponse } from 'http';
import { badRequest, fail, get, json, post, readJsonBody, type Route } from '@hats/service-kit/index';
import { resolveSpeakerId, resolveVoice } from '@hats/speech-core/voice-models';
import type { SpeechChunk, SynthesiseRequest } from '@hats/speech-core/types';
import { isSpeechAvailable, processSpeech, runPiperServer } from './pipeline.js';
import type { VoiceManager } from './voice-manager.js';

const BASE = '/api/v1';
const MAX_TEXT = 8000;

/** Strip the runtime-only fields; a client needs the name and its speakers. */
const describe = (v: { name: string; file: string; speakerId: number | null; speakers: unknown[] }) => ({
  name: v.name, file: v.file, speakerId: v.speakerId, speakers: v.speakers,
});

export function speechRoutes(voices: VoiceManager): Route[] {
  /** Resolve the requested voice, or the default, to something piper can use. */
  const target = (voiceName?: string, speakerName?: string) => {
    const voice = resolveVoice(voices.getVoices(), voiceName);
    return { voice, speakerId: resolveSpeakerId(voice, speakerName) };
  };

  return [
    get(`${BASE}/health`, ({ res }) => json(res, 200, {
      ok: true,
      service: 'speech',
      version: '1.0.0',
      voiceCount: voices.getVoices().length,
      speechAvailable: isSpeechAvailable() || voices.getVoices().length > 0,
    })),

    get(`${BASE}/voices`, ({ res }) => json(res, 200, { voices: voices.getVoices().map(describe) })),

    // Streamed synthesis — NDJSON, one SpeechChunk per line.
    post(`${BASE}/speech`, async ({ req, res }) => {
      const body = await readJsonBody<SynthesiseRequest>(req);
      const text = body?.text?.trim();
      if (!text) { badRequest(res, 'text is required'); return; }
      if (text.length > MAX_TEXT) { badRequest(res, `text exceeds ${MAX_TEXT} characters`); return; }

      const { voice, speakerId } = target(body?.voice, body?.speakerName);
      if (!voice && !isSpeechAvailable()) {
        fail(res, 503, 'No voice models are installed on this service', 'no_voices');
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      });

      try {
        await processSpeech(text, body?.agentName ?? 'agent', voice?.url ?? null, speakerId,
          (chunk: SpeechChunk) => writeLine(res, chunk));
      } catch (err) {
        // The stream is already open, so the failure is reported in-band.
        writeLine(res, { error: (err as Error).message });
      }
      res.end();
    }),

    // A short sample, returned whole as a WAV — a preview has no latency story.
    post(`${BASE}/speech/preview`, async ({ req, res }) => {
      const body = await readJsonBody<{ voice?: string; speakerName?: string; text?: string }>(req);
      const { voice, speakerId } = target(body?.voice, body?.speakerName);
      if (!voice) { fail(res, 503, 'No voice models are installed on this service', 'no_voices'); return; }

      const sample = body?.text?.trim() || 'Hello. I am ready to help with your project.';
      try {
        // Same call the pipeline makes, so the endpoint cannot drift apart.
        const wav = await runPiperServer(sample, voice.url, speakerId);
        res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wav.length });
        res.end(wav);
      } catch (err) {
        fail(res, 502, (err as Error).message, 'tts_failed');
      }
    }),
  ];
}

function writeLine(res: ServerResponse, value: unknown): void {
  res.write(`${JSON.stringify(value)}\n`);
}
