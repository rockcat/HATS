export interface TTSRequest {
  text: string;
  voice?: string;
  speed?: number;      // 0.25 – 4.0, default 1.0
}

export interface TTSResult {
  audioBuffer: Buffer;   // complete MP3 audio
  durationMs: number;    // estimated duration
}

export interface TTSProvider {
  name: string;
  synthesise(req: TTSRequest): Promise<TTSResult>;
}
