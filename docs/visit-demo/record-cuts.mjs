// What to keep of a recording: everything, except the middle of a long wait.
//
// While the agents think, the screen barely changes. A wait longer than
// CUT.minWait keeps its first CUT.head ms (what was asked) and its last
// CUT.tail ms (what came of it); the middle goes. record.mjs shows a caption
// such as "2 min later" as each long wait ends, so the cut is honest.

export const CUT = { minWait: 10_000, head: 2_500, tail: 4_000 };

/**
 * @param {{ from: number, to: number }[]} waits  ms from the start of the recording
 * @param {number} total  ms recorded
 * @returns {{ start: number, end: number }[]} the stretches to keep, in order
 */
export function keepSegments(waits, total, cut = CUT) {
  const drops = waits
    .filter((w) => w.to - w.from > cut.minWait)
    .map((w) => ({ start: w.from + cut.head, end: w.to - cut.tail }))
    .sort((a, b) => a.start - b.start);
  const keep = [];
  let at = 0;
  for (const d of drops) {
    if (d.start > at) keep.push({ start: at, end: Math.min(d.start, total) });
    at = Math.max(at, d.end);
  }
  if (at < total) keep.push({ start: at, end: total });
  return keep.filter((k) => k.end - k.start > 0);
}

/** A wait's length in words, for the caption shown as it ends. */
export function laterText(ms) {
  if (ms >= 60_000) return `${Math.round(ms / 60_000)} min later`;
  return `${Math.max(1, Math.round(ms / 1000))} s later`;
}
