// ── Making the mouth match the words ──────────────────────────────────────────
//
// The runner returns, per sentence, a WAV and a timeline:
//
//   { viseme: 'viseme_aa', start: 0, end: 0.05 }   // seconds
//
// Driving a face from that is three separate problems, and only the first is
// interesting enough to be worth testing on its own:
//
//  1. Which viseme is showing at time *t* — pure, and the part that goes
//     wrong silently if the units are confused. The timeline is in **seconds**
//     while everything around it is in milliseconds.
//  2. Turning that into VRM expression weights, or into GLB morph targets.
//     Two entirely different mechanisms for the same intent.
//  3. Moving smoothly between them, because snapping from shape to shape at
//     eighty milliseconds a phoneme reads as a glitch rather than speech.
//
// No imports: shared by every renderer, testable without a canvas.

/** VRM 1.x vowel expressions, by viseme. A shape with no entry closes the mouth. */
export const VISEME_TO_VRM = {
  viseme_sil: {},
  viseme_aa:  { aa: 1.0 },
  viseme_E:   { ee: 1.0 },
  viseme_O:   { oh: 1.0 },
  viseme_U:   { ou: 1.0 },
  viseme_OO:  { ou: 0.8 },
  viseme_PP:  {},
  viseme_FF:  { ih: 0.7 },
  viseme_nn:  { ih: 0.4, aa: 0.2 },
  viseme_SS:  { ih: 0.5 },
  viseme_TH:  {},
};

/** Every vowel expression touched during speech, so each can be cleared. */
export const VRM_VOWELS = ['aa', 'ih', 'ou', 'ee', 'oh'];

/** How fast a weight moves toward its target, per frame. */
export const BLEND = 0.4;

/**
 * Which viseme is showing at `seconds` into the timeline.
 *
 * Returns `viseme_sil` before the first and after the last, so the mouth
 * closes rather than holding the final shape — a face frozen mid-vowel after
 * a sentence is worse than one that simply stops.
 *
 * @param {Array<{viseme: string, start: number, end: number}>} timeline
 * @param {number} seconds elapsed since the audio began
 */
export function visemeAt(timeline, seconds) {
  if (!Array.isArray(timeline) || timeline.length === 0) return 'viseme_sil';
  for (const frame of timeline) {
    if (seconds >= frame.start && seconds < frame.end) return frame.viseme ?? 'viseme_sil';
  }
  return 'viseme_sil';
}

/** Has the timeline finished? */
export function isFinished(timeline, seconds) {
  if (!Array.isArray(timeline) || timeline.length === 0) return true;
  return seconds >= (timeline[timeline.length - 1]?.end ?? 0);
}

/**
 * Move current weights one frame toward the target shape.
 *
 * Returns a new object rather than mutating, so a caller can keep the
 * previous frame if it wants to.
 */
export function stepWeights(current, target, blend = BLEND) {
  const next = { ...current };
  const names = new Set([...Object.keys(current), ...Object.keys(target)]);
  for (const name of names) {
    const want = target[name] ?? 0;
    const have = next[name] ?? 0;
    const value = have + (want - have) * blend;
    // Settle rather than approach for ever, so an idle face is exactly closed.
    next[name] = Math.abs(value - want) < 0.01 ? want : value;
  }
  return next;
}

// ── VRM ──────────────────────────────────────────────────────────────────────

/** Apply weights to a VRM's expression manager. */
export function applyVrmWeights(vrm, weights) {
  const expressions = vrm?.expressionManager;
  if (!expressions) return;
  for (const vowel of VRM_VOWELS) {
    expressions.setValue(vowel, weights[vowel] ?? 0);
  }
}

// ── GLB morph targets ────────────────────────────────────────────────────────

/** Parts of a model that are never a mouth, however they are named. */
const NOT_A_FACE = ['torso', 'chest', 'body', 'shoulder', 'arm', 'hand', 'leg',
  'foot', 'hair', 'glasses', 'hat', 'outfit', 'shirt', 'bottom', 'shoe'];

/**
 * Meshes with viseme morph targets.
 *
 * Ready Player Me names them `viseme_aa` and so on, matching the timeline
 * exactly. Body meshes are skipped: some carry the same morph names and
 * driving them makes the model twitch while it talks.
 */
export function collectVisemeMeshes(scene) {
  const meshes = [];
  scene?.traverse?.((obj) => {
    const dictionary = obj.morphTargetDictionary;
    if (!dictionary) return;
    const name = (obj.name ?? '').toLowerCase();
    if (NOT_A_FACE.some((word) => name.includes(word))) return;
    if (!Object.keys(dictionary).some((key) => key.startsWith('viseme_'))) return;
    meshes.push(obj);
  });
  return meshes;
}

/**
 * Drive morph targets straight from the viseme name.
 *
 * Unlike VRM, there is no mapping to do — the morph target *is* the viseme,
 * so the current one goes to 1 and every other to 0.
 */
export function applyMorphWeights(meshes, viseme, weights) {
  for (const mesh of meshes) {
    const dictionary = mesh.morphTargetDictionary ?? {};
    const influences = mesh.morphTargetInfluences;
    if (!influences) continue;
    for (const [name, index] of Object.entries(dictionary)) {
      if (!name.startsWith('viseme_')) continue;
      influences[index] = weights[name] ?? (name === viseme ? 1 : 0);
    }
  }
}

/** Target weights for a GLB, where each viseme is its own morph target. */
export function morphTargetFor(viseme) {
  return viseme && viseme !== 'viseme_sil' ? { [viseme]: 1 } : {};
}

/** Target weights for a VRM, where visemes map onto a few vowels. */
export function vrmTargetFor(viseme) {
  return VISEME_TO_VRM[viseme] ?? {};
}

// ── Talking without a timeline ───────────────────────────────────────────────
//
// The browser's own voice gives no viseme data — only "started" and "ended".
// A still mouth through a whole spoken reply reads as broken, so this makes a
// plausible one from the clock.
//
// It is not pretending to be accurate. It is the difference between a face
// that is obviously talking and a face that is obviously frozen, and only the
// second is a bug.

/** The shapes to cycle through, chosen to look like speech rather than chewing. */
const CHATTER = ['viseme_aa', 'viseme_E', 'viseme_nn', 'viseme_O', 'viseme_E', 'viseme_U'];

/** Roughly a syllable. Slower reads as lethargic, faster as a glitch. */
export const CHATTER_STEP_MS = 140;

/**
 * A mouth shape for `seconds` into an untimed utterance.
 *
 * Deterministic on the clock rather than random, so two faces speaking the
 * same words stay in step and a dropped frame does not restart the pattern.
 */
export function chatterVisemeAt(seconds) {
  if (!(seconds >= 0)) return 'viseme_sil';
  const step = Math.floor((seconds * 1000) / CHATTER_STEP_MS);
  return CHATTER[step % CHATTER.length];
}
