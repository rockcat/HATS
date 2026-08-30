// Phoneme → VisemeId mappings (ARPAbet phoneme set from CMU dict).
import { VisemeId } from './types.js';

export const VISEME_IDS: VisemeId[] = ['rest', 'AI', 'E', 'O', 'U', 'MBP', 'FV', 'LDN', 'WQ', 'SZ'];

export const VISEME_DESCRIPTIONS: Record<VisemeId, string> = {
  rest: 'Neutral / silence',
  AI:   'Open vowel (ah, ai, eye)',
  E:    'Mid-front vowel (eh, ee)',
  O:    'Back vowel (oh)',
  U:    'Rounded vowel (oo, you)',
  MBP:  'Bilabial plosive (m, b, p)',
  FV:   'Labiodental fricative (f, v)',
  LDN:  'Alveolar (l, d, n, t)',
  WQ:   'Rounded consonant (w, wh)',
  SZ:   'Sibilant (s, z, sh, ch)',
};

/** Maps ARPAbet phoneme codes to VisemeId groups */
export const PHONEME_TO_VISEME: Record<string, VisemeId> = {
  // Vowels
  AA: 'AI', AE: 'AI', AH: 'AI', AW: 'AI', AY: 'AI',
  EH: 'E',  ER: 'E',  EY: 'E',  IH: 'E',  IY: 'E',
  OW: 'O',  OY: 'O',
  UH: 'U',  UW: 'U',
  // Bilabials
  B: 'MBP', M: 'MBP', P: 'MBP',
  // Labiodentals
  F: 'FV', V: 'FV',
  // Alveolars
  D: 'LDN', L: 'LDN', N: 'LDN', T: 'LDN', DH: 'LDN', TH: 'LDN',
  // Sibilants
  S: 'SZ', Z: 'SZ', SH: 'SZ', ZH: 'SZ', CH: 'SZ', JH: 'SZ',
  // Rounded
  W: 'WQ', WH: 'WQ',
  // Others default to rest
  G: 'AI', HH: 'AI', K: 'AI', NG: 'LDN', R: 'AI', Y: 'AI',
};
