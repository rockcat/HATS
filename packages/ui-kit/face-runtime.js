// ── Running a face model in the browser ──────────────────────────────────────
//
// LiteRT (what TensorFlow Lite is called now) runs in a browser through
// LiteRT.js, so the same `.tflite` file a phone uses works in a tab, on
// WebGPU where it exists and WebAssembly where it does not. That is what lets
// a face stay on the device instead of a photograph being posted to a server.
//
// Two models, not one, and they do different jobs:
//
//  * MediaPipe's FaceDetector finds *where* a face is. Fast, tiny, already
//    packaged for the web.
//  * A recognition model — MobileFaceNet by default — turns that crop into
//    the vector that says *who* it is. There is no web-packaged task for
//    this, so it is the one loaded through LiteRT.js directly.
//
// Both are fetched at first use rather than on page load. They are a few
// megabytes between them and most conversations never ask who anybody is.
//
// Nothing here throws for want of a model file. A runner that cannot
// recognise faces is a normal runner, and a tab that cannot is a normal tab —
// it simply does not declare the capability, and the agent is never offered
// something that would always fail.

import {
  MOBILEFACENET, confidenceOf, faceCropBox, inputShape, l2normalise, largestFace,
  normalisePixels, whyUnusable,
} from './face-embedding.js';

/** Where the pieces come from, all overridable for self-hosting. */
export const DEFAULT_SOURCES = Object.freeze({
  /** LiteRT.js itself, and its WebAssembly. */
  litertModule: 'https://cdn.jsdelivr.net/npm/@litertjs/core@2.5.3/+esm',
  litertWasm: 'https://cdn.jsdelivr.net/npm/@litertjs/core@2.5.3/wasm/',
  /** MediaPipe's vision tasks, and the detector's own weights. */
  mediapipeModule: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/+esm',
  mediapipeWasm: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm',
  detectorModel:
    'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
  /**
   * The recognition model.
   *
   * Local by default and deliberately not a CDN URL: this one decides the
   * embedding space every stored face lives in, so it should be a file whose
   * contents are known and pinned, served from the same origin as the app.
   */
  embedderModel: '/models/mobilefacenet.tflite',
});

/**
 * Is there any chance of this working here?
 *
 * Cheap and synchronous, for deciding whether to declare the capability
 * before anything has been downloaded.
 */
export function canEmbedFaces(scope = globalThis) {
  return typeof scope.fetch === 'function'
    && typeof scope.OffscreenCanvas !== 'undefined'
    || typeof scope.document !== 'undefined';
}

/**
 * Face recognition on this device.
 *
 * Built once and kept; `load()` is idempotent and concurrent callers share
 * the one download.
 */
export class FaceEmbedder {
  /**
   * @param {object} [options]
   * @param {object} [options.profile]  which model, and how it wants its input
   * @param {object} [options.sources]  where to fetch the pieces from
   * @param {(message: string) => void} [options.onProblem]
   */
  constructor({ profile = MOBILEFACENET, sources = {}, onProblem } = {}) {
    this.profile = profile;
    this.sources = { ...DEFAULT_SOURCES, ...sources };
    this.onProblem = onProblem ?? (() => {});
    this.detector = null;
    this.model = null;
    this.Tensor = null;
    this.loading = null;
    /** Set once we know it cannot work, so we stop retrying every frame. */
    this.unavailable = null;
    this.canvas = null;
  }

  get ready() { return !!this.model && !!this.detector; }

  /**
   * Fetch and compile both models.
   *
   * Resolves false rather than throwing when something is missing — most
   * often the recognition model, which is not shipped in the repo. The
   * caller's job is then to not declare the capability, not to show an error.
   */
  async load() {
    if (this.ready) return true;
    if (this.unavailable) return false;
    if (this.loading) return this.loading;

    this.loading = this.#load()
      .catch((err) => {
        this.unavailable = String(err?.message ?? err);
        this.onProblem(this.unavailable);
        return false;
      })
      .finally(() => { this.loading = null; });
    return this.loading;
  }

  async #load() {
    const [litert, vision] = await Promise.all([
      import(/* @vite-ignore */ this.sources.litertModule),
      import(/* @vite-ignore */ this.sources.mediapipeModule),
    ]);

    await litert.loadLiteRt(this.sources.litertWasm);
    this.Tensor = litert.Tensor;

    // WebGPU where it exists, WebAssembly where it does not. Both produce the
    // same vectors; only the speed differs, so a fallback is not a
    // degradation that anybody needs telling about.
    this.model = await loadWithFallback(litert, this.sources.embedderModel, this.onProblem);

    const files = await vision.FilesetResolver.forVisionTasks(this.sources.mediapipeWasm);
    this.detector = await vision.FaceDetector.createFromOptions(files, {
      baseOptions: { modelAssetPath: this.sources.detectorModel },
      runningMode: 'IMAGE',
    });

    return true;
  }

  /**
   * Find a face in a frame and return its vector.
   *
   * @param {CanvasImageSource & {width: number, height: number}} source
   *   anything drawable — a video element, an ImageBitmap, a canvas
   * @returns {Promise<{vector: number[], confidence: number} | {reason: string}>}
   *   a vector, or why there is not one. Not finding a face is an answer
   *   rather than a failure, and the agent needs to be able to tell the
   *   difference between "nobody is there" and "this is broken".
   */
  async embed(source) {
    if (!await this.load()) {
      return { reason: this.unavailable ?? 'Face recognition is not available here.' };
    }

    const width = source.videoWidth ?? source.width;
    const height = source.videoHeight ?? source.height;
    if (!width || !height) return { reason: 'There is no picture to look at yet.' };

    const found = this.detector.detect(source);
    const face = largestFace(found?.detections);
    if (!face) return { reason: 'I cannot see a face.' };

    const crop = faceCropBox(face.boundingBox, { width, height }, this.profile);
    const pixels = this.#drawCrop(source, crop);
    const input = normalisePixels(pixels, this.profile);

    const tensor = new this.Tensor(input, inputShape(this.profile));
    let raw;
    try {
      const outputs = await this.model.run(tensor);
      const output = Array.isArray(outputs) ? outputs[0] : outputs;
      raw = await output.data();
      output.delete?.();
    } finally {
      // Not garbage collected: these hold GPU memory, and leaking one per
      // frame takes a long camera session down.
      tensor.delete?.();
    }

    const vector = l2normalise(raw);
    if (!vector) return { reason: 'That face produced an empty vector.' };

    const wrong = whyUnusable(vector, this.profile);
    if (wrong) return { reason: wrong };

    return { vector, confidence: confidenceOf(face) };
  }

  /** Crop and scale into the model's square, reusing one canvas. */
  #drawCrop(source, crop) {
    const n = this.profile.inputSize;
    if (!this.canvas) {
      this.canvas = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(n, n)
        : Object.assign(document.createElement('canvas'), { width: n, height: n });
    }
    const context = this.canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, n, n);
    return context.getImageData(0, 0, n, n).data;
  }

  /** Let go of the GPU. */
  close() {
    try { this.detector?.close?.(); } catch { /* already gone */ }
    try { this.model?.delete?.(); } catch { /* same */ }
    this.detector = null;
    this.model = null;
  }
}

/**
 * Compile on the fastest backend that works.
 *
 * WebGPU is not merely absent on some machines — it is present and then fails
 * on compile for a model using an op its backend does not have, which is why
 * this catches rather than feature-detects.
 */
async function loadWithFallback(litert, path, onProblem) {
  for (const accelerator of ['webgpu', 'wasm']) {
    try {
      return await litert.loadAndCompile(path, { accelerator });
    } catch (err) {
      if (accelerator === 'wasm') throw err;
      onProblem(`WebGPU could not run the face model (${err?.message ?? err}); using WebAssembly.`);
    }
  }
  throw new Error('unreachable');
}
