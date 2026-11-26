import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MARGIN, DEFAULT_THRESHOLD, comparable, identify, magnitude, normalise,
  scoreAgainst, similarity, worthStoring,
} from './matching.js';
import type { FaceTemplate, Person } from './types.js';

const MODEL = 'mobilefacenet-v1';

const template = (vector: number[], over: Partial<FaceTemplate> = {}): FaceTemplate => ({
  model: MODEL,
  dimensions: vector.length,
  vector: normalise(vector),
  addedAt: '2026-10-16T09:00:00.000Z',
  ...over,
});

const person = (name: string, vectors: number[][], over: Partial<Person> = {}): Person => ({
  id: name.toLowerCase(),
  name,
  templates: vectors.map((v) => template(v)),
  consent: { granted: true, at: '2026-10-16T09:00:00.000Z' },
  createdAt: '2026-10-16T09:00:00.000Z',
  ...over,
});

/** A vector pointing mostly along one axis, with a little noise. */
const facing = (axis: number, noise = 0, length = 8) =>
  Array.from({ length }, (_, i) => (i === axis ? 1 : 0) + (i === (axis + 1) % length ? noise : 0));

describe('vector arithmetic', () => {
  it('measures length', () => {
    expect(magnitude([3, 4])).toBe(5);
    expect(magnitude([0, 0])).toBe(0);
  });

  it('scales to unit length', () => {
    expect(magnitude(normalise([3, 4]))).toBeCloseTo(1, 10);
  });

  it('leaves a zero vector alone rather than dividing by zero', () => {
    expect(normalise([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it('does not modify its input', () => {
    const original = [3, 4];
    normalise(original);
    expect(original).toEqual([3, 4]);
  });
});

describe('comparing two faces', () => {
  it('scores an identical vector as 1', () => {
    expect(similarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
  });

  it('ignores scale, which is the point of using cosine', () => {
    expect(similarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 10);
  });

  it('scores an unrelated direction near zero', () => {
    expect(similarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });

  it('scores an opposite direction as -1', () => {
    expect(similarity([1, 0], [-1, 0])).toBeCloseTo(-1, 10);
  });

  it('returns 0 for vectors of different lengths, rather than throwing', () => {
    // That means two different models: a question with no answer, not a crash.
    expect(similarity([1, 2, 3], [1, 2])).toBe(0);
  });

  it('returns 0 for an empty vector', () => {
    expect(similarity([], [])).toBe(0);
  });

  it('survives a zero vector', () => {
    expect(similarity([0, 0], [1, 1])).toBe(0);
  });
});

describe('choosing which templates can be compared', () => {
  const mixed: FaceTemplate[] = [
    template([1, 0, 0, 0, 0, 0, 0, 0]),
    template([1, 0], { model: MODEL, dimensions: 2 }),
    template([1, 0, 0, 0, 0, 0, 0, 0], { model: 'arcface' }),
  ];

  it('keeps only the same model at the same size', () => {
    expect(comparable(mixed, MODEL, 8)).toHaveLength(1);
  });

  it('excludes another model, however well the sizes line up', () => {
    // Vectors from two models are unrelated numbers, not a worse match.
    expect(comparable(mixed, 'arcface', 2)).toHaveLength(0);
  });
});

describe('scoring a person', () => {
  it('takes their best template, not an average of them', () => {
    // Templates are different angles of one face. Averaging drags a good
    // match down towards the worst photograph on file.
    const paul = person('Paul', [facing(0), facing(3), facing(5)]);
    expect(scoreAgainst(paul, normalise(facing(3)), MODEL)).toBeCloseTo(1, 6);
  });

  it('returns -1 when they have nothing in this model\'s space', () => {
    const paul = person('Paul', [facing(0)]);
    expect(scoreAgainst(paul, normalise(facing(0)), 'arcface')).toBe(-1);
  });
});

describe('identifying somebody', () => {
  const paul = person('Paul', [facing(0)]);
  const rhoda = person('Rhoda', [facing(4)]);

  it('names a clear match', () => {
    const result = identify([paul, rhoda], normalise(facing(0)), { model: MODEL });

    expect(result.outcome).toBe('known');
    if (result.outcome === 'known') {
      expect(result.person.name).toBe('Paul');
      expect(result.score).toBeCloseTo(1, 6);
    }
  });

  it('says unknown when nobody is close enough', () => {
    const result = identify([paul, rhoda], normalise(facing(7)), { model: MODEL });
    expect(result.outcome).toBe('unknown');
  });

  it('says unsure rather than guessing between two close faces', () => {
    // The failure that matters: calling Rhoda "Paul" is confidently wrong and
    // obvious to everyone in the room. Asking is merely awkward.
    const twins = [person('Paul', [[1, 0.98, 0, 0]]), person('Rhoda', [[1, 1, 0, 0]])];
    const result = identify(twins, normalise([1, 0.99, 0, 0]), { model: MODEL });

    expect(result.outcome).toBe('unsure');
    if (result.outcome === 'unsure') {
      expect(result.candidates.map((c) => c.person.name).sort()).toEqual(['Paul', 'Rhoda']);
    }
  });

  it('is not made unsure by a runner-up below the threshold', () => {
    // Someone well below the bar is not a competing answer, however close the
    // two numbers happen to look.
    const result = identify([paul, rhoda], normalise(facing(0)), {
      model: MODEL, threshold: 0.9, margin: 0.9,
    });
    expect(result.outcome).toBe('known');
  });

  it('offers at most three candidates when unsure', () => {
    const crowd = Array.from({ length: 6 }, (_, i) => person(`P${i}`, [[1, 1, 0, 0]]));
    const result = identify(crowd, normalise([1, 1, 0, 0]), { model: MODEL });

    expect(result.outcome).toBe('unsure');
    if (result.outcome === 'unsure') expect(result.candidates.length).toBeLessThanOrEqual(3);
  });

  it('says there is nothing to compare against when nobody is on file', () => {
    expect(identify([], normalise(facing(0)), { model: MODEL }).outcome).toBe('no-templates');
  });

  it('says the same when everyone on file used a different model', () => {
    // Not "unknown": nobody has been ruled out, we simply cannot look.
    const result = identify([paul, rhoda], normalise(facing(0)), { model: 'arcface' });
    expect(result.outcome).toBe('no-templates');
  });

  it('honours a stricter threshold', () => {
    const nearly = identify([paul], normalise([1, 0.3, 0, 0, 0, 0, 0, 0]), {
      model: MODEL, threshold: 0.99,
    });
    expect(nearly.outcome).toBe('unknown');
  });

  it('has sensible defaults', () => {
    expect(DEFAULT_THRESHOLD).toBeGreaterThan(0.5);
    expect(DEFAULT_THRESHOLD).toBeLessThan(0.8);
    expect(DEFAULT_MARGIN).toBeGreaterThan(0);
  });
});

describe('deciding whether to keep a new template', () => {
  const paul = person('Paul', [facing(0)]);

  it('keeps a genuinely new angle', () => {
    expect(worthStoring(paul, normalise([1, 0.6, 0, 0, 0, 0, 0, 0]), MODEL)).toBe(true);
  });

  it('skips one almost identical to what is already there', () => {
    // It teaches nothing and makes every later comparison slower.
    expect(worthStoring(paul, normalise(facing(0)), MODEL)).toBe(false);
  });

  it('refuses one that looks like somebody else entirely', () => {
    // Almost certainly a mis-enrolment, and storing it poisons both identities.
    expect(worthStoring(paul, normalise(facing(5)), MODEL)).toBe(false);
  });

  it('keeps the first template in a new model\'s space', () => {
    expect(worthStoring(paul, normalise(facing(0)), 'arcface')).toBe(true);
  });
});
