// ── When a mic press means record, and when it means stop ────────────────────
//
// No imports and no DOM, so this is directly testable; `panels.js` is the part
// that wires it to a button and a MediaRecorder.
//
// The rule has to cover two habits at once. Hold-to-talk — press, speak,
// release — is what the button was built for. Click-to-start is what most
// people try first, and it used to start a recording that the matching release
// stopped a few milliseconds later: no audio, no message, nothing to see.

/** Below this, a press was a click rather than a hold. */
export const HOLD_MS = 400;

/**
 * What a press or release should do, given what is already happening.
 *
 * @param {'press'|'release'} event
 * @param {{recording: boolean, heldMs: number, latched: boolean}} at
 * @returns {'start'|'stop'|'latch'|'ignore'}
 */
export function micAction(event, at) {
  if (event === 'press') return at.recording ? 'stop' : 'start';
  if (!at.recording) return 'ignore';
  // Released too soon to have been a hold: stay on until the next click.
  if (at.heldMs < HOLD_MS) return 'latch';
  return at.latched ? 'ignore' : 'stop';
}
