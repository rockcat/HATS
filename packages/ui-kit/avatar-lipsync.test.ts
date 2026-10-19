import { describe, it, expect } from 'vitest';
// @ts-expect-error — a browser module with no imports, so it loads here.
import {
  BLEND, VISEME_TO_VRM, VRM_VOWELS, applyMorphWeights, applyVrmWeights,
  chatterVisemeAt, collectVisemeMeshes, isFinished, morphTargetFor, stepWeights,
  visemeAt, vrmTargetFor,
} from './avatar-lipsync.js';

/** A timeline in the shape the runner actually sends: seconds, not ms. */
const timeline = [
  { viseme: 'viseme_aa', start: 0, end: 0.05 },
  { viseme: 'viseme_nn', start: 0.05, end: 0.09 },
  { viseme: 'viseme_E', start: 0.09, end: 0.37 },
];

describe('which shape is showing', () => {
  it('finds the one covering this instant', () => {
    expect(visemeAt(timeline, 0.02)).toBe('viseme_aa');
    expect(visemeAt(timeline, 0.07)).toBe('viseme_nn');
    expect(visemeAt(timeline, 0.2)).toBe('viseme_E');
  });

  it('treats a boundary as belonging to the later shape', () => {
    // Half-open intervals, so no instant belongs to two frames.
    expect(visemeAt(timeline, 0.05)).toBe('viseme_nn');
    expect(visemeAt(timeline, 0.09)).toBe('viseme_E');
  });

  it('closes the mouth before the audio starts', () => {
    expect(visemeAt(timeline, -0.1)).toBe('viseme_sil');
  });

  it('closes the mouth after the last shape', () => {
    // A face frozen mid-vowel after a sentence is worse than one that stops.
    expect(visemeAt(timeline, 5)).toBe('viseme_sil');
  });

  it('is silent given nothing to show', () => {
    expect(visemeAt([], 1)).toBe('viseme_sil');
    expect(visemeAt(undefined, 1)).toBe('viseme_sil');
  });

  it('reads the units as seconds, not milliseconds', () => {
    // The timeline is in seconds while the audio API is in ms; confusing the
    // two makes the mouth finish before the first word is out.
    expect(visemeAt(timeline, 0.3)).toBe('viseme_E');
    expect(visemeAt(timeline, 300)).toBe('viseme_sil');
  });
});

describe('knowing when to stop', () => {
  it('is finished past the last frame', () => {
    expect(isFinished(timeline, 0.37)).toBe(true);
    expect(isFinished(timeline, 1)).toBe(true);
  });

  it('is not finished partway through', () => {
    expect(isFinished(timeline, 0.2)).toBe(false);
  });

  it('is finished immediately with nothing to play', () => {
    expect(isFinished([], 0)).toBe(true);
  });
});

describe('moving between shapes', () => {
  it('eases toward the target rather than snapping', () => {
    // Snapping between shapes at 80ms a phoneme reads as a glitch.
    const next = stepWeights({ aa: 0 }, { aa: 1 });
    expect(next.aa).toBeCloseTo(BLEND, 5);
    expect(next.aa).toBeLessThan(1);
  });

  it('arrives rather than approaching for ever', () => {
    let weights = { aa: 0 };
    for (let i = 0; i < 40; i++) weights = stepWeights(weights, { aa: 1 });
    expect(weights.aa).toBe(1);
  });

  it('closes a shape the new target does not mention', () => {
    const next = stepWeights({ aa: 1 }, { ee: 1 });
    expect(next.aa).toBeLessThan(1);
    expect(next.ee).toBeGreaterThan(0);
  });

  it('settles exactly closed, so an idle face is still', () => {
    let weights = { aa: 1 };
    for (let i = 0; i < 40; i++) weights = stepWeights(weights, {});
    expect(weights.aa).toBe(0);
  });

  it('does not mutate what it was given', () => {
    const before = { aa: 0 };
    stepWeights(before, { aa: 1 });
    expect(before.aa).toBe(0);
  });
});

describe('turning a viseme into weights', () => {
  it('maps onto VRM vowels', () => {
    expect(vrmTargetFor('viseme_aa')).toEqual({ aa: 1.0 });
    expect(vrmTargetFor('viseme_nn')).toEqual({ ih: 0.4, aa: 0.2 });
  });

  it('closes the mouth for silence and consonants with no shape', () => {
    expect(vrmTargetFor('viseme_sil')).toEqual({});
    expect(vrmTargetFor('viseme_PP')).toEqual({});
  });

  it('closes the mouth for a viseme it has never heard of', () => {
    expect(vrmTargetFor('viseme_klingon')).toEqual({});
  });

  it('uses the viseme directly on a GLB, where the morph is the viseme', () => {
    expect(morphTargetFor('viseme_aa')).toEqual({ viseme_aa: 1 });
    expect(morphTargetFor('viseme_sil')).toEqual({});
  });

  it('covers every viseme the runner sends', () => {
    // These are the names seen on the wire; a missing one is a silent mouth.
    for (const name of ['viseme_sil', 'viseme_aa', 'viseme_E', 'viseme_O',
      'viseme_U', 'viseme_PP', 'viseme_FF', 'viseme_nn', 'viseme_SS', 'viseme_TH']) {
      expect(VISEME_TO_VRM).toHaveProperty(name);
    }
  });
});

describe('finding the mouth on a GLB', () => {
  const mesh = (name: string, morphs: string[]) => ({
    name,
    morphTargetDictionary: Object.fromEntries(morphs.map((m, i) => [m, i])),
    morphTargetInfluences: morphs.map(() => 0),
  });

  const sceneOf = (meshes: unknown[]) => ({
    traverse(fn: (o: unknown) => void) { for (const m of meshes) fn(m); },
  });

  it('finds a mesh with viseme morphs', () => {
    const head = mesh('Wolf3D_Head', ['viseme_aa', 'viseme_E']);
    expect(collectVisemeMeshes(sceneOf([head]))).toHaveLength(1);
  });

  it('skips the body, which can carry the same morph names', () => {
    // Driving those makes the model twitch while it talks.
    const body = mesh('Wolf3D_Body', ['viseme_aa']);
    expect(collectVisemeMeshes(sceneOf([body]))).toEqual([]);
  });

  it('skips a mesh with no viseme morphs at all', () => {
    expect(collectVisemeMeshes(sceneOf([mesh('Head', ['browUp'])]))).toEqual([]);
  });

  it('copes with a scene it cannot walk', () => {
    expect(collectVisemeMeshes(undefined)).toEqual([]);
    expect(collectVisemeMeshes({})).toEqual([]);
  });

  it('drives the current viseme and clears the rest', () => {
    const head = mesh('Head', ['viseme_aa', 'viseme_E', 'browUp']);
    applyMorphWeights([head], 'viseme_aa', {});

    expect(head.morphTargetInfluences[0]).toBe(1);   // viseme_aa
    expect(head.morphTargetInfluences[1]).toBe(0);   // viseme_E
  });

  it('never touches a morph that is not a viseme', () => {
    // Writing a brow or a blink here would fight whatever owns it.
    const head = mesh('Head', ['viseme_aa', 'browUp']);
    head.morphTargetInfluences[1] = 0.7;
    applyMorphWeights([head], 'viseme_aa', {});

    expect(head.morphTargetInfluences[1]).toBe(0.7);
  });

  it('prefers blended weights when it is given them', () => {
    const head = mesh('Head', ['viseme_aa', 'viseme_E']);
    applyMorphWeights([head], 'viseme_aa', { viseme_aa: 0.3, viseme_E: 0.1 });

    expect(head.morphTargetInfluences[0]).toBeCloseTo(0.3, 5);
    expect(head.morphTargetInfluences[1]).toBeCloseTo(0.1, 5);
  });
});

describe('driving a VRM', () => {
  const vrmWith = () => {
    const set: Record<string, number> = {};
    return { expressionManager: { setValue: (n: string, v: number) => { set[n] = v; } }, set };
  };

  it('sets every vowel, so none is left stuck on', () => {
    const vrm = vrmWith();
    applyVrmWeights(vrm, { aa: 1 });

    for (const vowel of VRM_VOWELS) expect(vrm.set).toHaveProperty(vowel);
    expect(vrm.set.aa).toBe(1);
    expect(vrm.set.ee).toBe(0);
  });

  it('does nothing to a model with no expressions', () => {
    expect(() => applyVrmWeights({}, { aa: 1 })).not.toThrow();
    expect(() => applyVrmWeights(null, { aa: 1 })).not.toThrow();
  });
});

describe('talking without a timeline', () => {
  it('moves the mouth when there is no viseme data', () => {
    // The browser voice gives only "started" and "ended". A still mouth
    // through a whole reply reads as broken.
    const shapes = new Set(
      Array.from({ length: 12 }, (_, i) => chatterVisemeAt(i * 0.14)),
    );
    expect(shapes.size).toBeGreaterThan(2);
  });

  it('never leaves the mouth closed while talking', () => {
    for (let i = 0; i < 20; i++) {
      expect(chatterVisemeAt(i * 0.07)).not.toBe('viseme_sil');
    }
  });

  it('is deterministic on the clock, not random', () => {
    // So a dropped frame does not restart the pattern mid-word.
    expect(chatterVisemeAt(0.5)).toBe(chatterVisemeAt(0.5));
  });

  it('holds one shape for about a syllable', () => {
    expect(chatterVisemeAt(0.01)).toBe(chatterVisemeAt(0.13));
    expect(chatterVisemeAt(0.01)).not.toBe(chatterVisemeAt(0.15));
  });

  it('is silent before it starts', () => {
    expect(chatterVisemeAt(-1)).toBe('viseme_sil');
  });

  it('only ever produces shapes the mapping knows', () => {
    for (let i = 0; i < 20; i++) {
      expect(VISEME_TO_VRM).toHaveProperty(chatterVisemeAt(i * 0.14));
    }
  });
});
