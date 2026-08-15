/**
 * Maps Rhubarb Lip Sync mouth shapes (A–H, X) to ARKit viseme morph targets.
 *
 * Rhubarb shapes (Preston Blair):
 *   X  silence / rest
 *   A  "P", "B", "M"  — lips closed (bilabial)
 *   B  slightly open  — schwa, short vowels
 *   C  "EE"           — retracted, wide
 *   D  "OH"           — open rounded
 *   E  "OOH"          — very rounded / pursed
 *   F  "F", "V"       — teeth on lower lip
 *   G  "L"            — tongue up / alveolar
 *   H  "TH"           — tongue forward (optional, not always emitted)
 */
export const RHUBARB_TO_ARKIT: Record<string, string> = {
  X: 'viseme_sil',
  A: 'viseme_PP',
  B: 'viseme_aa',
  C: 'viseme_E',
  D: 'viseme_O',
  E: 'viseme_U',
  F: 'viseme_FF',
  G: 'viseme_nn',
  H: 'viseme_TH',
};
