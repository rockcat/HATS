// @vitest-environment node
import { describe, it, expect } from 'vitest';
// @ts-expect-error - plain JS module, shipped to the browser as-is
import {
  MOBILEFACENET, confidenceOf, faceCropBox, inputShape, l2normalise, largestFace,
  normalisePixels, whyUnusable,
} from './face-embedding.js';

const box = (originX: number, originY: number, width: number, height: number) =>
  ({ originX, originY, width, height });

/** An inputSize × inputSize RGBA buffer where every pixel is the same colour. */
const flat = (r: number, g: number, b: number, size = MOBILEFACENET.inputSize) => {
  const out = new Uint8ClampedArray(size * size * 4);
  for (let p = 0; p < size * size; p++) {
    out[p * 4] = r; out[p * 4 + 1] = g; out[p * 4 + 2] = b; out[p * 4 + 3] = 255;
  }
  return out;
};

describe('framing the face', () => {
  const image = { width: 640, height: 480 };

  it('is always square', () => {
    const crop = faceCropBox(box(100, 100, 80, 120), image);
    expect(crop.width).toBeCloseTo(crop.height);
  });

  it('takes the longer edge, so the sides of a face are not cut off', () => {
    const crop = faceCropBox(box(100, 100, 80, 120), image, { ...MOBILEFACENET, margin: 0 });
    expect(crop.width).toBeCloseTo(120);
  });

  it('opens the detector box out', () => {
    // Detectors give a tight box; recognition models are trained on a looser
    // crop. Using the box as given loses accuracy invisibly.
    const tight = faceCropBox(box(100, 100, 100, 100), image, { ...MOBILEFACENET, margin: 0 });
    const loose = faceCropBox(box(100, 100, 100, 100), image, { ...MOBILEFACENET, margin: 0.25 });
    expect(loose.width).toBeGreaterThan(tight.width);
    expect(loose.width).toBeCloseTo(150);
  });

  it('stays centred on the face', () => {
    const crop = faceCropBox(box(200, 150, 100, 100), image);
    expect(crop.x + crop.width / 2).toBeCloseTo(250);
    expect(crop.y + crop.height / 2).toBeCloseTo(200);
  });

  it('never runs off the edge', () => {
    // A crop hanging over the edge means black bars the model never saw in
    // training, so it is slid back inside instead.
    for (const b of [box(0, 0, 100, 100), box(590, 430, 100, 100), box(-20, -20, 80, 80)]) {
      const crop = faceCropBox(b, image);
      expect(crop.x, JSON.stringify(b)).toBeGreaterThanOrEqual(0);
      expect(crop.y, JSON.stringify(b)).toBeGreaterThanOrEqual(0);
      expect(crop.x + crop.width).toBeLessThanOrEqual(image.width + 1e-9);
      expect(crop.y + crop.height).toBeLessThanOrEqual(image.height + 1e-9);
    }
  });

  it('shrinks rather than overflow a face that fills the frame', () => {
    const crop = faceCropBox(box(0, 0, 640, 480), image);
    expect(crop.width).toBeLessThanOrEqual(480);
    expect(crop.height).toBeLessThanOrEqual(480);
  });

  it('copes with a picture narrower than the face box', () => {
    const crop = faceCropBox(box(0, 0, 200, 200), { width: 100, height: 100 });
    expect(crop).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });
});

describe('the shape of the input', () => {
  it('is NHWC for a TFLite model', () => {
    expect(inputShape(MOBILEFACENET)).toEqual([1, 112, 112, 3]);
  });

  it('is NCHW when the profile says so', () => {
    expect(inputShape({ ...MOBILEFACENET, layout: 'nchw' })).toEqual([1, 3, 112, 112]);
  });
});

describe('turning pixels into model input', () => {
  it('drops the alpha channel', () => {
    const out = normalisePixels(flat(0, 0, 0));
    expect(out.length).toBe(112 * 112 * 3);
  });

  it('maps black and white to the ends of the range', () => {
    const black = normalisePixels(flat(0, 0, 0))[0];
    const white = normalisePixels(flat(255, 255, 255))[0];
    expect(black).toBeCloseTo((0 - 127.5) / 128);
    expect(white).toBeCloseTo((255 - 127.5) / 128);
    expect(black).toBeLessThan(0);
    expect(white).toBeGreaterThan(0);
  });

  it('keeps the channels in order for an RGB model', () => {
    const out = normalisePixels(flat(255, 0, 0));
    expect(out[0]).toBeGreaterThan(0);   // red
    expect(out[1]).toBeLessThan(0);      // green
    expect(out[2]).toBeLessThan(0);      // blue
  });

  it('swaps red and blue for a BGR model', () => {
    // Silently the wrong way round is how a model that works in a demo
    // matches nobody in production.
    const out = normalisePixels(flat(255, 0, 0), { ...MOBILEFACENET, channels: 'bgr' });
    expect(out[0]).toBeLessThan(0);      // blue first
    expect(out[2]).toBeGreaterThan(0);   // red last
  });

  it('writes planar data for an NCHW model', () => {
    const size = 2;
    const profile = { ...MOBILEFACENET, inputSize: size, layout: 'nchw' };
    const rgba = new Uint8ClampedArray([
      255, 0, 0, 255, 255, 0, 0, 255,
      255, 0, 0, 255, 255, 0, 0, 255,
    ]);
    const out = normalisePixels(rgba, profile);
    // All four reds first, then all four greens, then all four blues.
    expect([...out.slice(0, 4)].every((v) => v > 0)).toBe(true);
    expect([...out.slice(4, 12)].every((v) => v < 0)).toBe(true);
  });

  it('says so when the crop was drawn at the wrong size', () => {
    expect(() => normalisePixels(flat(0, 0, 0, 64))).toThrow(/wrong size/);
  });
});

describe('finishing the vector', () => {
  it('comes out unit length', () => {
    const unit = l2normalise([3, 4]);
    expect(unit).not.toBeNull();
    const magnitude = Math.hypot(...(unit as number[]));
    expect(magnitude).toBeCloseTo(1);
  });

  it('keeps the direction', () => {
    expect(l2normalise([3, 4])).toEqual([0.6, 0.8]);
  });

  it('refuses a vector with no direction', () => {
    // A zero vector is equally similar to everybody, so storing one would
    // have the agent greet strangers by name.
    expect(l2normalise([0, 0, 0])).toBeNull();
  });

  it('refuses rubbish rather than propagating NaN', () => {
    expect(l2normalise([Number.NaN, 1])).toBeNull();
  });
});

describe('checking a vector before it is sent', () => {
  const good = new Array(MOBILEFACENET.dimensions).fill(0.1);

  it('passes one of the right size', () => {
    expect(whyUnusable(good)).toBeNull();
  });

  it('names the model when the size is wrong', () => {
    // The runner would reject this too, but only after it crossed the
    // network, and its complaint would not say which model was expected.
    const why = whyUnusable(new Array(512).fill(0.1));
    expect(why).toContain('512');
    expect(why).toContain(MOBILEFACENET.model);
  });

  it('catches NaN', () => {
    expect(whyUnusable([...good.slice(1), Number.NaN])).toMatch(/not numbers/);
  });

  it('catches a non-vector', () => {
    expect(whyUnusable(null)).toMatch(/not a vector/);
  });
});

describe('choosing which face', () => {
  const face = (w: number, h: number, score = 0.9) =>
    ({ boundingBox: { originX: 0, originY: 0, width: w, height: h }, categories: [{ score }] });

  it('takes the biggest, which is the person talking to you', () => {
    const chosen = largestFace([face(40, 40), face(200, 200), face(90, 90)]);
    expect(chosen?.boundingBox.width).toBe(200);
  });

  it('answers null when nobody is there', () => {
    expect(largestFace([])).toBeNull();
    expect(largestFace(undefined)).toBeNull();
  });

  it('ignores a detection with no box', () => {
    expect(largestFace([{ categories: [] }, face(50, 50)])?.boundingBox.width).toBe(50);
  });

  it('reads the confidence', () => {
    expect(confidenceOf(face(10, 10, 0.42))).toBeCloseTo(0.42);
    expect(confidenceOf({})).toBe(0);
  });
});
