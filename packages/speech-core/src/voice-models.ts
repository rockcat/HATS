/**
 * Discovering Piper voice models on disk.
 *
 * Shared so the Speech Service and the Agent Template Library agree on what a voice is
 * and which speakers it offers. The library only ever needs this — listing
 * voices for a dropdown requires no TTS process, which is why it can populate
 * its editor with no other service running.
 */

import { readFile, readdir } from 'fs/promises';
import * as path from 'path';
import type { Voice, VoiceSpeaker } from './types.js';

/** Speakers sort naturally, so "p10" follows "p9" rather than "p1". */
const byName = (a: VoiceSpeaker, b: VoiceSpeaker) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

/**
 * Read a model's companion `.onnx.json` for its speaker map.
 * A model with no map is single-speaker: no id, no list.
 */
export async function readSpeakers(
  configPath: string,
): Promise<{ speakerId: number | null; speakers: VoiceSpeaker[] }> {
  try {
    const config = JSON.parse(await readFile(configPath, 'utf-8')) as {
      speaker_id_map?: Record<string, number>;
    };
    const map = config.speaker_id_map;
    if (!map) return { speakerId: null, speakers: [] };
    const speakers = Object.entries(map).map(([name, id]) => ({ name, id })).sort(byName);
    return speakers.length > 0
      ? { speakerId: speakers[0]!.id, speakers }
      : { speakerId: null, speakers: [] };
  } catch {
    return { speakerId: null, speakers: [] };
  }
}

/** Every installed voice model, sorted by name. Empty when none are installed. */
export async function listVoices(voicesDir: string): Promise<Voice[]> {
  let files: string[];
  try {
    files = await readdir(voicesDir);
  } catch {
    return [];
  }

  const models = files.filter((f) => f.endsWith('.onnx') && !f.endsWith('.onnx.json'));
  const voices = await Promise.all(models.map(async (file) => {
    const name = file.replace(/\.onnx$/, '');
    const { speakerId, speakers } = await readSpeakers(path.join(voicesDir, `${file}.json`));
    return { name, file, speakerId, speakers };
  }));

  return voices.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Where the voice models live.
 * `PIPER_VOICES_DIR` wins; otherwise the directory holding `PIPER_MODEL`.
 */
export function resolveVoicesDir(): string | null {
  const explicit = process.env['PIPER_VOICES_DIR'];
  if (explicit) return path.resolve(explicit);
  const model = process.env['PIPER_MODEL'];
  return model ? path.dirname(path.resolve(model)) : null;
}

/** Pick a voice by name, falling back to the first installed one. */
export function resolveVoice<T extends Voice>(voices: T[], preferred: string | undefined): T | undefined {
  if (voices.length === 0) return undefined;
  if (preferred) {
    const match = voices.find((v) => v.name === preferred);
    if (match) return match;
  }
  return voices[0];
}

/** Resolve a speaker name to the integer id piper expects. */
export function resolveSpeakerId(voice: Voice | undefined, speakerName: string | undefined): number | null {
  if (!voice) return null;
  if (speakerName && voice.speakers.length > 0) {
    const found = voice.speakers.find((s) => s.name === speakerName);
    if (found) return found.id;
  }
  return voice.speakerId;
}
