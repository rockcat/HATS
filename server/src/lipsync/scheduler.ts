import { VisemeId } from '../avatar/types.js';
import { textToPhonemes } from './phonemes.js';

export interface VisemeEvent {
  visemeId: VisemeId;
  startMs: number;
  durationMs: number;
}

const AVG_PHONEME_DURATION_MS = 80;   // ~80ms per phoneme at normal speech rate
const WORD_PAUSE_MS = 60;             // pause between words

export async function buildVisemeTimeline(
  text: string,
  totalDurationMs?: number,
): Promise<VisemeEvent[]> {
  const phonemes = await textToPhonemes(text);
  if (phonemes.length === 0) return [];

  // Build raw timeline with fixed durations
  const raw: VisemeEvent[] = [];
  let cursor = 0;

  for (const entry of phonemes) {
    const duration = entry.phoneme === 'SP' ? WORD_PAUSE_MS : AVG_PHONEME_DURATION_MS;
    raw.push({ visemeId: entry.viseme, startMs: cursor, durationMs: duration });
    cursor += duration;
  }

  // If we know the total audio duration, scale timing to fit
  if (totalDurationMs && totalDurationMs > 0 && cursor > 0) {
    const scale = totalDurationMs / cursor;
    return raw.map((e) => ({
      visemeId: e.visemeId,
      startMs: Math.round(e.startMs * scale),
      durationMs: Math.round(e.durationMs * scale),
    }));
  }

  return raw;
}

export function getVisemeAt(timeline: VisemeEvent[], elapsedMs: number): VisemeId {
  for (let i = timeline.length - 1; i >= 0; i--) {
    const event = timeline[i]!;
    if (elapsedMs >= event.startMs) return event.visemeId;
  }
  return 'rest';
}
