/**
 * Driving a VRM mouth from the same viseme stream the GLB avatars use.
 *
 * GLB heads carry ARKit-style `viseme_*` morph targets. VRM instead exposes five
 * standard vowel expressions, so the viseme names are mapped onto those weights
 * here rather than teaching the rest of the pipeline about two mouth models.
 */

const VOWELS = ['aa', 'ih', 'ou', 'ee', 'oh'];

/** ARKit/Oculus viseme name → VRM vowel expression weights. */
const VISEME_TO_VRM = {
  viseme_sil: {},
  viseme_aa:  { aa: 1.0 },
  viseme_E:   { ee: 1.0 },
  viseme_O:   { oh: 1.0 },
  viseme_U:   { ou: 1.0 },
  viseme_PP:  {},                    // closed mouth
  viseme_FF:  { ih: 0.7 },
  viseme_TH:  { ih: 0.4, aa: 0.2 },
  viseme_nn:  { ih: 0.5 },
};

const BLEND = 0.4;

/** Ease the live weights toward the target viseme. Mutates `weights`. */
export function stepVrmWeights(weights, targetViseme) {
  const target = VISEME_TO_VRM[targetViseme] ?? {};
  for (const vowel of VOWELS) {
    const want = target[vowel] ?? 0;
    const have = weights[vowel] ?? 0;
    weights[vowel] = have + (want - have) * BLEND;
  }
  return weights;
}

/** Write the current weights onto the VRM's expression manager. */
export function applyVrmWeights(vrm, weights) {
  const expressions = vrm?.expressionManager;
  if (!expressions) return;
  for (const vowel of VOWELS) {
    expressions.setValue(vowel, weights[vowel] ?? 0);
  }
}
