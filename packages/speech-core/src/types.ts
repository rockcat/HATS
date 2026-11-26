/**
 * Shared speech types.
 *
 * These cross the Speech Service boundary, so they are the contract between
 * whatever synthesises audio and whatever plays it or drives a mouth with it.
 */

export interface VisemeEvent {
  /** ARKit viseme name, e.g. "viseme_aa". */
  viseme: string;
  /** Seconds from the start of this chunk's audio. */
  start: number;
  end: number;
}

/**
 * One sentence of synthesised speech.
 *
 * Speech is delivered a sentence at a time so a listener can start playing —
 * and a mouth can start moving — before the whole utterance is rendered.
 */
export interface SpeechChunk {
  /** Zero-based index within this utterance. */
  id: number;
  totalChunks: number;
  sentence: string;
  /** base64-encoded WAV. */
  audioBase64: string;
  visemes: VisemeEvent[];
  /** Seconds. */
  duration: number;
  /** Who is speaking — echoed back so a client can route the audio. */
  agentName: string;
}

export interface VoiceSpeaker {
  /** Key from the model's speaker_id_map, e.g. "p239". */
  name: string;
  /** Integer piper expects as speaker_id. */
  id: number;
}

export interface Voice {
  /** e.g. "en_GB-cori-high" */
  name: string;
  file: string;
  /** Default speaker id; null for a single-speaker model. */
  speakerId: number | null;
  /** All speakers; empty for a single-speaker model. */
  speakers: VoiceSpeaker[];
}

/** A voice the service has actually started, and where to reach it. */
export interface RunningVoice extends Voice {
  modelPath: string;
  port: number;
  url: string;
}

export interface SynthesiseRequest {
  text: string;
  /** Voice model name. Falls back to the service default when absent. */
  voice?: string;
  /** Speaker within a multi-speaker model. */
  speakerName?: string;
  /** Echoed into each chunk so a client can route audio to the right agent. */
  agentName?: string;
}
