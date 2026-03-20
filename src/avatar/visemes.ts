import { VisemeId } from './types.js';

export const VISEME_IDS: VisemeId[] = [
  'rest', 'AI', 'E', 'O', 'U', 'MBP', 'FV', 'LDN', 'WQ', 'SZ',
];

// ARPAbet phoneme → viseme mapping
export const PHONEME_TO_VISEME: Record<string, VisemeId> = {
  // Silence / rest
  SIL: 'rest',
  SP:  'rest',

  // A, I sounds
  AA: 'AI', AE: 'AI', AH: 'AI', AW: 'AI', AY: 'AI',
  IH: 'AI', IY: 'AI',

  // E sounds
  EH: 'E', ER: 'E', EY: 'E',

  // O sounds
  OW: 'O', OY: 'O', AO: 'O',

  // U sounds
  UH: 'U', UW: 'U',

  // M, B, P — lips closed
  M: 'MBP', B: 'MBP', P: 'MBP',

  // F, V — teeth on lower lip
  F: 'FV', V: 'FV',

  // L, D, N, TH — tongue behind teeth
  L: 'LDN', D: 'LDN', N: 'LDN', T: 'LDN',
  DH: 'LDN', TH: 'LDN',

  // W, Q — rounded lips
  W: 'WQ',

  // S, Z — teeth together
  S: 'SZ', Z: 'SZ', SH: 'SZ', ZH: 'SZ', CH: 'SZ', JH: 'SZ',

  // Remaining consonants default to rest-ish open position
  G: 'AI', K: 'AI', NG: 'AI',
  HH: 'AI', R: 'AI', Y: 'AI',
};

export const VISEME_DESCRIPTIONS: Record<VisemeId, string> = {
  rest:  'mouth closed, neutral relaxed expression, lips together',
  AI:    'mouth open wide, jaw dropped, tongue visible, "ah" sound',
  E:     'mouth open medium, corners pulled back slightly, "eh" sound',
  O:     'mouth in round O shape, lips pursed forward, "oh" sound',
  U:     'mouth in tight round shape, lips strongly pursed, "oo" sound',
  MBP:   'lips pressed firmly together, about to open, "m" or "b" sound',
  FV:    'upper teeth resting lightly on lower lip, "f" sound',
  LDN:   'mouth slightly open, tongue tip raised toward upper teeth, "l" sound',
  WQ:    'lips rounded and protruding forward, "w" sound',
  SZ:    'teeth nearly together, lips slightly apart, "s" sound',
};
