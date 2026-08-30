import { IncomingMessage, ServerResponse } from 'http';
import { VoiceManager } from '../speech/voice-manager.js';
import { processSpeech, isSpeechAvailable } from '../speech/pipeline.js';

export interface SpeechRouterDeps {
  voiceManager: VoiceManager;
  json(res: ServerResponse, status: number, body: unknown): void;
  readBody(req: IncomingMessage): Promise<string>;
  readBodyBuffer(req: IncomingMessage): Promise<Buffer>;
}

export class SpeechRouter {
  private deps: SpeechRouterDeps;

  constructor(deps: SpeechRouterDeps) {
    this.deps = deps;
  }

  async handleRoutes(pathname: string, method: string, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const { json, readBody, readBodyBuffer, voiceManager } = this.deps;

    if (pathname === '/api/voices') {
      json(res, 200, voiceManager.getVoices());
      return true;
    }

    if (pathname === '/api/speech/preview' && method === 'POST') {
      const voices = voiceManager.getVoices();
      if (voices.length === 0) { json(res, 404, { error: 'No voices configured' }); return true; }
      const body = await readBody(req);
      const { voice: voiceName, speakerName } = JSON.parse(body) as { voice?: string; speakerName?: string };
      const voice = voiceManager.resolveVoice(voiceName);
      if (!voice) { json(res, 404, { error: 'Voice not found' }); return true; }
      try {
        let speakerId: number | null = voice.speakerId;
        if (speakerName && voice.speakers.length > 0) {
          const found = voice.speakers.find(s => s.name === speakerName);
          if (found) speakerId = found.id;
        }
        const payload: Record<string, unknown> = { text: 'Hello  I am ready to help with your project.' };
        if (speakerId !== null) payload['speaker_id'] = speakerId;
        const piperRes = await fetch(`${voice.url}/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(15_000),
        });
        if (!piperRes.ok) { json(res, 502, { error: `TTS error: ${piperRes.status}` }); return true; }
        const wavBuffer = Buffer.from(await piperRes.arrayBuffer());
        res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': String(wavBuffer.length) });
        res.end(wavBuffer);
      } catch (err) {
        json(res, 500, { error: (err as Error).message });
      }
      return true;
    }

    if (pathname === '/api/speech/transcribe' && method === 'POST') {
      const apiKey = process.env['OPENAI_API_KEY'];
      if (!apiKey) { json(res, 400, { error: 'OPENAI_API_KEY not set — Whisper unavailable' }); return true; }
      const audioBuffer = await readBodyBuffer(req);
      if (!audioBuffer.length) { json(res, 400, { error: 'No audio data received' }); return true; }
      try {
        const contentType = req.headers['content-type'] ?? 'audio/webm';
        const ext = contentType.includes('mp4') ? 'mp4'
                  : contentType.includes('ogg')  ? 'ogg'
                  : contentType.includes('wav')  ? 'wav'
                  : 'webm';
        const blob = new Blob([new Uint8Array(audioBuffer)], { type: contentType });
        const form = new FormData();
        form.append('file', blob, `recording.${ext}`);
        form.append('model', 'whisper-1');
        const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}` },
          body: form,
          signal: AbortSignal.timeout(30_000),
        });
        if (!whisperRes.ok) {
          const err = await whisperRes.text();
          json(res, 502, { error: `Whisper API error: ${whisperRes.status} — ${err}` }); return true;
        }
        const data = await whisperRes.json() as { text: string };
        json(res, 200, { text: data.text?.trim() ?? '' });
      } catch (err) {
        json(res, 500, { error: (err as Error).message });
      }
      return true;
    }

    if (pathname === '/api/speech/synthesise' && method === 'POST') {
      const voices = voiceManager.getVoices();
      if (voices.length === 0) { json(res, 404, { error: 'No voices configured' }); return true; }
      const body = await readBody(req);
      const { text, voice: voiceName, speakerName } = JSON.parse(body) as { text?: string; voice?: string; speakerName?: string };
      if (!text?.trim()) { json(res, 400, { error: 'text required' }); return true; }
      const voice = voiceManager.resolveVoice(voiceName);
      if (!voice) { json(res, 404, { error: 'Voice not found' }); return true; }
      try {
        let speakerId: number | null = voice.speakerId;
        if (speakerName && voice.speakers.length > 0) {
          const found = voice.speakers.find(s => s.name === speakerName);
          if (found) speakerId = found.id;
        }
        res.writeHead(200, {
          'Content-Type': 'application/x-ndjson',
          'Transfer-Encoding': 'chunked',
          'Cache-Control': 'no-cache',
        });
        await processSpeech(text, '__meeting__', voice.url, speakerId, (chunk) => {
          res.write(JSON.stringify(chunk) + '\n');
        });
        res.end();
      } catch (err) {
        if (!res.headersSent) json(res, 500, { error: (err as Error).message });
        else res.end();
      }
      return true;
    }

    // isSpeechAvailable is referenced for the check in start() but not a route
    void isSpeechAvailable;
    return false;
  }
}
