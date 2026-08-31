/**
 * The Piper voice catalogue, read straight off disk.
 *
 * The Team Runner's VoiceManager also starts a TTS server per voice; the
 * library only needs the list to populate the editor's dropdowns, so it reads
 * the same `.onnx.json` configs without spawning anything. Previewing a voice
 * does need real synthesis, and goes through the runner.
 */

import { readFile, readdir } from 'fs/promises';
import * as path from 'path';

export interface VoiceSpeaker {
  /** Key from speaker_id_map, e.g. "p239". */
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

/** Speakers sort naturally, so "p10" follows "p9" rather than "p1". */
const byName = (a: VoiceSpeaker, b: VoiceSpeaker) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

async function readSpeakers(configPath: string): Promise<{ speakerId: number | null; speakers: VoiceSpeaker[] }> {
  try {
    const config = JSON.parse(await readFile(configPath, 'utf-8')) as { speaker_id_map?: Record<string, number> };
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
