import OpenAI from 'openai';
import { TTSProvider, TTSRequest, TTSResult } from './types.js';

// Average speaking rate used for duration estimation when exact duration unavailable
const AVG_WORDS_PER_MINUTE = 150;

export class OpenAITTSProvider implements TTSProvider {
  readonly name = 'openai-tts';
  private client: OpenAI;

  constructor(apiKey?: string) {
    this.client = new OpenAI({ apiKey: apiKey ?? process.env['OPENAI_API_KEY'] });
  }

  async synthesise(req: TTSRequest): Promise<TTSResult> {
    const response = await this.client.audio.speech.create({
      model: 'tts-1',
      voice: (req.voice as 'alloy') ?? 'alloy',
      input: req.text,
      speed: req.speed ?? 1.0,
      response_format: 'mp3',
    });

    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);
    const durationMs = estimateDurationMs(req.text, req.speed ?? 1.0);

    return { audioBuffer, durationMs };
  }
}

function estimateDurationMs(text: string, speed: number): number {
  const wordCount = text.trim().split(/\s+/).length;
  const minutes = wordCount / (AVG_WORDS_PER_MINUTE * speed);
  return Math.round(minutes * 60 * 1000);
}
