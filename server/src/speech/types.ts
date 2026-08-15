export interface VisemeEvent {
  viseme: string;
  start: number;
  end: number;
}

export interface SpeechChunk {
  id: number;
  totalChunks: number;
  sentence: string;
  audioBase64: string;   // base64-encoded WAV
  visemes: VisemeEvent[];
  duration: number;
  agentName: string;
}
