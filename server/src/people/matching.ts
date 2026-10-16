// ── Deciding who this is ──────────────────────────────────────────────────────
//
// The whole of face recognition, once the vectors exist: compare a probe
// against what is on file and decide whether it is close enough to use a name.
//
// The judgement that matters is not the similarity threshold, it is what to do
// when two people are close. Greeting Rhoda as Paul is a worse failure than
// asking who she is — it is confidently wrong, it is obvious to everybody in
// the room, and it is the kind of thing that stops people trusting the whole
// feature. So a match needs two things: enough absolute similarity, *and*
// enough of a margin over the runner-up. Without the margin a pair of similar
// faces produces a coin-flip delivered with total confidence.

import type { FaceTemplate, Person, Recognition } from './types.js';

/**
 * How alike two faces must look before a name is used.
 *
 * Cosine similarity on L2-normalised embeddings, so the range is -1 to 1.
 * 0.6 is a conventional starting point for this family of models; it is
 * configurable because the right value depends on the model and on how much a
 * wrong name costs in the room the device is in.
 */
export const DEFAULT_THRESHOLD = 0.6;

/** How far ahead of the runner-up the winner must be to be believed. */
export const DEFAULT_MARGIN = 0.05;

export interface MatchOptions {
  /** Only templates from this model are considered. */
  model: string;
  threshold?: number;
  margin?: number;
}

/** Length of a vector. Exported because callers normalise before storing. */
export function magnitude(vector: number[]): number {
  let sum = 0;
  for (const v of vector) sum += v * v;
  return Math.sqrt(sum);
}

/**
 * Scale a vector to unit length.
 *
 * Done once on the way in rather than on every comparison: with everything
 * normalised, cosine similarity is just a dot product, and a thousand
 * comparisons cost a thousand multiply-adds instead of a thousand square
 * roots. A zero vector is returned unchanged — there is no direction to keep.
 */
export function normalise(vector: number[]): number[] {
  const length = magnitude(vector);
  return length === 0 ? [...vector] : vector.map((v) => v / length);
}

/**
 * Cosine similarity, tolerating un-normalised input.
 *
 * Returns 0 for mismatched lengths rather than throwing: that means two
 * different models, which is a question with no answer rather than a crash.
 */
export function similarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  const scale = magnitude(a) * magnitude(b);
  return scale === 0 ? 0 : dot / scale;
}

/** Templates comparable with this probe: same model, same dimensions. */
export function comparable(templates: FaceTemplate[], model: string, dimensions: number): FaceTemplate[] {
  return templates.filter((t) => t.model === model && t.dimensions === dimensions);
}

/**
 * How well a probe matches a person.
 *
 * The best of their templates, not the average: templates are different
 * angles and lighting conditions of the same face, so averaging them drags a
 * good match down towards the worst photograph on file.
 */
export function scoreAgainst(person: Person, probe: number[], model: string): number {
  const usable = comparable(person.templates, model, probe.length);
  let best = -1;
  for (const template of usable) {
    const score = similarity(probe, template.vector);
    if (score > best) best = score;
  }
  return best;
}

/**
 * Who is this?
 *
 * Returns `unsure` rather than guessing when two people are close, because
 * the cost of the two mistakes is not symmetric: asking a known person their
 * name is mildly awkward, calling somebody by the wrong name is not.
 */
export function identify(people: Person[], probe: number[], options: MatchOptions): Recognition {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const margin = options.margin ?? DEFAULT_MARGIN;

  const scored = people
    .map((person) => ({ person, score: scoreAgainst(person, probe, options.model) }))
    .filter((c) => c.score > -1)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { outcome: 'no-templates' };

  const best = scored[0]!;
  if (best.score < threshold) return { outcome: 'unknown' };

  const runnerUp = scored[1];
  // Only a runner-up who is *also* above the threshold can create doubt. One
  // well below it is not a competing answer, however close the numbers look.
  if (runnerUp && runnerUp.score >= threshold && best.score - runnerUp.score < margin) {
    return {
      outcome: 'unsure',
      candidates: scored.filter((c) => c.score >= threshold).slice(0, 3),
    };
  }

  return { outcome: 'known', person: best.person, score: best.score };
}

/**
 * Is this template worth keeping?
 *
 * A face almost identical to one already on file teaches nothing and makes
 * every later comparison slower. One that looks like somebody else entirely
 * is probably a mis-enrolment, and storing it would poison both identities.
 */
export function worthStoring(
  person: Person, probe: number[], model: string,
  { duplicateAbove = 0.98, strangerBelow = 0.5 } = {},
): boolean {
  const score = scoreAgainst(person, probe, model);
  if (score === -1) return true; // nothing to compare with: the first of its kind
  return score < duplicateAbove && score >= strangerBelow;
}
