// ── Turning a face in a frame into a vector, in a browser ────────────────────
//
// The arithmetic half of face recognition on the device: how to frame a face
// the detector found, how to turn those pixels into the numbers a model
// expects, and how to finish the vector it gives back. The runtime half —
// loading LiteRT and MediaPipe, driving a camera — is in face-runtime.js, so
// that all of this can be tested without either.
//
// It is split that way because this is the part that fails silently. Get the
// crop, the channel order or the normalisation wrong and the model still
// returns 192 plausible-looking floats; they simply match nobody, for ever,
// and there is nothing in the output to say which of the three was wrong.
// Hence a profile that states every constant explicitly rather than a set of
// assumptions spread through the code.

/** L2 distance conventions shared with the runner's matcher. */
export const VECTOR_IS_UNIT_LENGTH = true;

/**
 * How one model wants its input, and what it gives back.
 *
 * Every field here has to match the `.tflite` file actually loaded. They are
 * written out rather than inferred because a mismatch produces vectors that
 * look fine and match nobody — the hardest failure in this whole feature to
 * notice, and the easiest to introduce by swapping the model file.
 */
export const MOBILEFACENET = Object.freeze({
  /** The id stored against every template, and negotiated with the runner. */
  model: 'mobilefacenet-v1',
  dimensions: 192,
  /** Square input, in pixels. */
  inputSize: 112,
  /** `nhwc` is the usual TFLite layout; `nchw` is the usual ONNX one. */
  layout: 'nhwc',
  channels: 'rgb',
  // (pixel - 127.5) / 128, the InsightFace convention MobileFaceNet is
  // trained with. Scaling by 128 rather than 127.5 is not a rounding slip.
  mean: 127.5,
  scale: 128,
  /**
   * How much to open the detector's box out before cropping.
   *
   * Detectors return a tight box around the features; recognition models are
   * trained on a looser crop that includes some forehead and jaw. Cropping to
   * the box as given is a common and invisible way to lose accuracy.
   */
  margin: 0.25,
});

/**
 * Square the detector's box, pad it, and keep it inside the picture.
 *
 * Always square and always in bounds, because the alternatives are both
 * worse: letting it hang over the edge means black bars the model was never
 * trained on, and squashing a rectangle to fit distorts the face differently
 * depending on how close to the edge the person stood.
 *
 * @param {{originX: number, originY: number, width: number, height: number}} box
 * @param {{width: number, height: number}} image
 * @param {{margin?: number}} [profile]
 */
export function faceCropBox(box, image, profile = MOBILEFACENET) {
  const margin = profile.margin ?? 0;
  const centreX = box.originX + box.width / 2;
  const centreY = box.originY + box.height / 2;

  // The longer edge wins, so a box that is taller than it is wide does not
  // crop the sides of the face off.
  let side = Math.max(box.width, box.height) * (1 + margin * 2);
  side = Math.min(side, image.width, image.height);

  return {
    x: clamp(centreX - side / 2, 0, image.width - side),
    y: clamp(centreY - side / 2, 0, image.height - side),
    width: side,
    height: side,
  };
}

/** The shape the model's input tensor wants. */
export function inputShape(profile = MOBILEFACENET) {
  const n = profile.inputSize;
  return profile.layout === 'nchw' ? [1, 3, n, n] : [1, n, n, 3];
}

/**
 * RGBA pixels from a canvas into the floats the model wants.
 *
 * Takes the alpha channel out, puts the colours in the model's order and
 * layout, and shifts them into its range.
 *
 * @param {Uint8ClampedArray|Uint8Array} rgba  inputSize × inputSize, 4 bytes a pixel
 */
export function normalisePixels(rgba, profile = MOBILEFACENET) {
  const n = profile.inputSize;
  const pixels = n * n;
  if (rgba.length < pixels * 4) {
    throw new Error(
      `Expected ${pixels * 4} bytes for a ${n}×${n} RGBA image, got ${rgba.length}. `
      + 'The crop was drawn at the wrong size.',
    );
  }

  const { mean = 127.5, scale = 128 } = profile;
  const planar = profile.layout === 'nchw';
  // Red and blue swapped for a BGR model. Alpha is dropped either way.
  const order = profile.channels === 'bgr' ? [2, 1, 0] : [0, 1, 2];

  const out = new Float32Array(pixels * 3);
  for (let p = 0; p < pixels; p++) {
    for (let c = 0; c < 3; c++) {
      const value = (rgba[p * 4 + order[c]] - mean) / scale;
      out[planar ? c * pixels + p : p * 3 + c] = value;
    }
  }
  return out;
}

/**
 * Finish a raw model output into a comparable vector.
 *
 * Unit length, because the runner compares by cosine similarity and a vector
 * of a different magnitude is not wrong so much as unanswerable.
 *
 * Returns null rather than a zero vector: a zero vector has no direction, so
 * it is equally similar to everybody, and storing one would make the agent
 * greet strangers by name.
 *
 * @returns {number[] | null}
 */
export function l2normalise(vector) {
  let sum = 0;
  for (let i = 0; i < vector.length; i++) sum += vector[i] * vector[i];
  const length = Math.sqrt(sum);
  if (!Number.isFinite(length) || length === 0) return null;

  const out = new Array(vector.length);
  for (let i = 0; i < vector.length; i++) out[i] = vector[i] / length;
  return out;
}

/**
 * Check a finished vector before it goes anywhere near the register.
 *
 * The runner rejects a wrong-length vector too, but by then it has crossed
 * the network and the agent has been told something unhelpful about
 * dimensions. Catching it here says which model was expected.
 *
 * @returns {string | null} what is wrong, or null if nothing is
 */
export function whyUnusable(vector, profile = MOBILEFACENET) {
  if (!Array.isArray(vector)) return 'That is not a vector.';
  if (vector.length !== profile.dimensions) {
    return `This is a ${vector.length}-dimension vector and ${profile.model} `
      + `produces ${profile.dimensions}. The loaded model is not the one configured.`;
  }
  if (vector.some((v) => !Number.isFinite(v))) {
    return 'That vector contains values that are not numbers.';
  }
  return null;
}

/**
 * Pick the face to use when the detector found several.
 *
 * The biggest, which in a conversation is the person actually talking to you
 * rather than somebody at the far end of the room. Returns null for an empty
 * list so the caller can say "nobody is there" rather than guess.
 */
export function largestFace(detections) {
  let best = null;
  let bestArea = 0;
  for (const detection of detections ?? []) {
    const box = detection?.boundingBox;
    if (!box) continue;
    const area = (box.width ?? 0) * (box.height ?? 0);
    if (area > bestArea) { best = detection; bestArea = area; }
  }
  return best;
}

/** How confident the detector was, as a plain number. */
export function confidenceOf(detection) {
  const score = detection?.categories?.[0]?.score;
  return typeof score === 'number' ? score : 0;
}

function clamp(value, low, high) {
  // high can be below low when the crop is as big as the picture.
  if (high < low) return low;
  return Math.min(Math.max(value, low), high);
}
