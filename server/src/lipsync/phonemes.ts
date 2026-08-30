import { VisemeId } from '../avatar/types.js';
import { PHONEME_TO_VISEME } from '../avatar/visemes.js';

export interface PhonemeEntry {
  phoneme: string;
  viseme: VisemeId;
}

// Lazy-load the CMU dictionary
let dictCache: Record<string, string> | null = null;

async function getDict(): Promise<Record<string, string>> {
  if (dictCache) return dictCache;
  const mod = await import('cmu-pronouncing-dictionary');
  dictCache = mod.dictionary as Record<string, string>;
  return dictCache;
}

export async function textToPhonemes(text: string): Promise<PhonemeEntry[]> {
  const dict = await getDict();
  const words = text
    .toLowerCase()
    .replace(/[^a-z\s']/g, '')
    .split(/\s+/)
    .filter(Boolean);

  const entries: PhonemeEntry[] = [];

  for (const word of words) {
    const pronunciation = dict[word];
    if (pronunciation) {
      const phonemes = pronunciation.split(' ');
      for (const phoneme of phonemes) {
        // Strip stress markers (0, 1, 2) from vowels
        const clean = phoneme.replace(/[012]$/, '');
        const viseme = PHONEME_TO_VISEME[clean] ?? 'rest';
        entries.push({ phoneme: clean, viseme });
      }
    } else {
      // Unknown word — approximate from letters
      const approximated = approximatePhonemes(word);
      entries.push(...approximated);
    }

    // Brief pause between words
    entries.push({ phoneme: 'SP', viseme: 'rest' });
  }

  return entries;
}

function approximatePhonemes(word: string): PhonemeEntry[] {
  const entries: PhonemeEntry[] = [];
  for (const char of word) {
    const viseme = LETTER_TO_VISEME[char] ?? 'rest';
    entries.push({ phoneme: char.toUpperCase(), viseme });
  }
  return entries;
}

const LETTER_TO_VISEME: Record<string, VisemeId> = {
  a: 'AI', e: 'E', i: 'AI', o: 'O', u: 'U',
  b: 'MBP', m: 'MBP', p: 'MBP',
  f: 'FV', v: 'FV',
  l: 'LDN', d: 'LDN', n: 'LDN', t: 'LDN',
  w: 'WQ',
  s: 'SZ', z: 'SZ',
  c: 'SZ', g: 'AI', h: 'AI', j: 'SZ', k: 'AI',
  q: 'WQ', r: 'AI', x: 'SZ', y: 'AI',
};
