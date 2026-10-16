import { describe, it, expect } from 'vitest';
import { hasCamera, negotiate, sanitise, type DeviceCapabilities } from './capabilities.js';

const MOBILEFACENET = { model: 'mobilefacenet-v1', dimensions: 192 };
// A runner that both names the canonical model and can run it.
const runner = { faceEmbedding: MOBILEFACENET, canEmbed: true };

describe('deciding where a face gets embedded', () => {
  it('uses the device when it runs the same model', () => {
    // The good case: a vector crosses the wire instead of a photograph.
    const agreed = negotiate({ faceEmbedding: [MOBILEFACENET] }, runner);

    expect(agreed.faceEmbedding).toBe('device');
    expect(agreed.faceModel).toEqual(MOBILEFACENET);
  });

  it('falls back to the runner when the device cannot embed at all', () => {
    // A browser tab showing the same avatar, or an older build of the app.
    expect(negotiate({ camera: { lenses: ['front'] } }, runner).faceEmbedding).toBe('runner');
  });

  it('falls back to the runner when the device offers a different model', () => {
    // This is the whole reason the exchange names a model. A vector from
    // another model is not a worse answer, it is a meaningless one — it would
    // sit in the store matching nothing and nobody could tell why.
    const agreed = negotiate({ faceEmbedding: [{ model: 'arcface', dimensions: 512 }] }, runner);
    expect(agreed.faceEmbedding).toBe('runner');
  });

  it('falls back when the model name matches but the dimensions do not', () => {
    // A retrained model under the same name produces a different space.
    const agreed = negotiate({ faceEmbedding: [{ model: 'mobilefacenet-v1', dimensions: 512 }] }, runner);
    expect(agreed.faceEmbedding).toBe('runner');
  });

  it('picks the matching model out of several a device offers', () => {
    const agreed = negotiate({
      faceEmbedding: [{ model: 'arcface', dimensions: 512 }, MOBILEFACENET],
    }, runner);
    expect(agreed.faceEmbedding).toBe('device');
  });

  it('says nowhere when no canonical model is named', () => {
    // Without one there is no store to put a vector in, whoever computes it.
    expect(negotiate({ faceEmbedding: [MOBILEFACENET] }, {}).faceEmbedding).toBe('nowhere');
  });

  it('still uses the device when the runner names a model it cannot run', () => {
    // The common case: no embedding runtime on the server, but a phone that
    // can do it faster and without sending the picture anywhere.
    const agreed = negotiate(
      { faceEmbedding: [MOBILEFACENET] }, { faceEmbedding: MOBILEFACENET });
    expect(agreed.faceEmbedding).toBe('device');
  });

  it('says nowhere when neither end can run the named model', () => {
    // Not "runner": claiming it would have the device stop trying and send
    // pictures to something that cannot read them.
    const agreed = negotiate({ camera: { lenses: ['front'] } }, { faceEmbedding: MOBILEFACENET });
    expect(agreed.faceEmbedding).toBe('nowhere');
    expect(agreed.faceModel).toEqual(MOBILEFACENET);
  });

  it('copes with a device that declared nothing', () => {
    expect(negotiate(undefined, runner).faceEmbedding).toBe('runner');
  });
});

describe('whether there is a camera', () => {
  it('believes a device that names its lenses', () => {
    expect(hasCamera({ camera: { lenses: ['front', 'back'] } })).toBe(true);
  });

  it('does not take an empty list as a yes', () => {
    expect(hasCamera({ camera: { lenses: [] } })).toBe(false);
    expect(hasCamera({ camera: {} })).toBe(false);
    expect(hasCamera(undefined)).toBe(false);
  });
});

describe('tidying what a client sent', () => {
  it('keeps a well-formed declaration', () => {
    const clean = sanitise({
      faceEmbedding: [MOBILEFACENET],
      camera: { lenses: ['front'] },
      speech: { recognition: true, synthesis: false },
    });

    expect(clean).toEqual({
      faceEmbedding: [MOBILEFACENET],
      camera: { lenses: ['front'] },
      speech: { recognition: true, synthesis: false },
    });
  });

  it('drops a model with no name', () => {
    // It would sit in the store poisoning comparisons.
    expect(sanitise({ faceEmbedding: [{ model: '  ', dimensions: 192 }] }).faceEmbedding)
      .toBeUndefined();
  });

  it('drops a model with nonsense dimensions', () => {
    const rubbish = [
      { model: 'x', dimensions: 0 },
      { model: 'x', dimensions: -1 },
      { model: 'x', dimensions: 1.5 },
      { model: 'x', dimensions: 'lots' },
      { model: 'x' },
    ];
    expect(sanitise({ faceEmbedding: rubbish }).faceEmbedding).toBeUndefined();
  });

  it('keeps the good models and drops the bad ones from the same list', () => {
    const clean = sanitise({ faceEmbedding: [{ model: '', dimensions: 1 }, MOBILEFACENET] });
    expect(clean.faceEmbedding).toEqual([MOBILEFACENET]);
  });

  it('drops lenses that are not strings', () => {
    expect(sanitise({ camera: { lenses: [1, null, 'front', ''] } }).camera)
      .toEqual({ lenses: ['front'] });
  });

  it('ignores speech flags that are not booleans', () => {
    expect(sanitise({ speech: { recognition: 'yes' } }).speech).toBeUndefined();
  });

  it('returns an empty declaration for nonsense, rather than throwing', () => {
    // It came from a client; it can be anything.
    expect(sanitise(null)).toEqual({});
    expect(sanitise('a string')).toEqual({});
    expect(sanitise(42)).toEqual({});
    expect(sanitise({ faceEmbedding: 'yes please' })).toEqual({});
  });

  it('ignores keys it does not know about', () => {
    // A newer client declaring something this runner has never heard of
    // should still register, not be rejected.
    expect(sanitise({ teleportation: true, camera: { lenses: ['back'] } }))
      .toEqual({ camera: { lenses: ['back'] } });
  });
});
