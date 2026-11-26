import { IncomingMessage, ServerResponse } from 'http';
import type { SpeechGateway } from '../speech/speech-gateway.js';

export interface SpeechRouterDeps {
  speech: SpeechGateway;
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
    const { json, readBody, readBodyBuffer, speech } = this.deps;

    if (pathname === '/api/voices') {
      json(res, 200, speech.getVoices());
      return true;
    }

    if (pathname === '/api/speech/preview' && method === 'POST') {
      const body = await readBody(req);
      const { voice: voiceName, speakerName } = JSON.parse(body) as { voice?: string; speakerName?: string };
      const voice = speech.resolveVoice(voiceName);
      if (!voice) { json(res, 404, { error: 'No voices configured' }); return true; }

      const wav = await speech.preview(voice.name, speakerName);
      if (!wav) { json(res, 502, { error: 'Speech Service could not render a preview' }); return true; }
      res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': String(wav.length) });
      res.end(wav);
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
      const body = await readBody(req);
      const { text, voice: voiceName, speakerName } = JSON.parse(body) as { text?: string; voice?: string; speakerName?: string };
      if (!text?.trim()) { json(res, 400, { error: 'text required' }); return true; }
      if (!speech.isAvailable()) { json(res, 503, { error: 'No Speech Service available' }); return true; }

      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache',
      });
      // Forwarded per sentence, so a caller can play as it arrives.
      await speech.speak(text, '__meeting__', voiceName, speakerName, (chunk) => {
        res.write(`${JSON.stringify(chunk)}
`);
      });
      res.end();
      return true;
    }

    return false;
  }
}
