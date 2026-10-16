// ── Turning a face into numbers ───────────────────────────────────────────────
//
// The one part of this that needs a neural network, and the one part not worth
// bundling. `onnxruntime-node` unpacks to roughly 300MB and TensorFlow's node
// bindings download a comparable native library at install time; neither
// belongs in a repo by default for a feature most runs will never touch.
//
// It is also usually the wrong place to do the work. A phone embeds a face in
// a few milliseconds and sends a vector of a couple of kilobytes instead of a
// photograph, which is faster and keeps the face on the device. The runner is
// the fallback for clients that cannot — a browser tab, an older build — and a
// fallback that costs 300MB to have available is a poor trade.
//
// So the runtime is optional and loaded only if it is installed. The runner
// still names the canonical model either way, because that is what the stored
// templates are in and a device may well be able to produce them.

import { log } from '../util/logger.js';
import type { EmbeddingModel } from '../device/capabilities.js';

/** Anything that can turn a face image into a vector. */
export interface FaceEmbedder {
  /** Which model this is. Stored against every template it produces. */
  readonly model: EmbeddingModel;
  /**
   * Embed the largest face in an image.
   *
   * Returns null when there is no face to embed — an empty frame, a photo of
   * a wall — which is an answer rather than a failure.
   */
  embed(image: Buffer): Promise<number[] | null>;
}

/** How the runner was told to embed, if at all. */
export interface EmbedderConfig {
  /** Path to an ONNX face-recognition model. */
  modelPath?: string;
  /** Its id, recorded against every template so vectors stay comparable. */
  modelName?: string;
  /** The length of the vectors it produces. */
  dimensions?: number;
  /** Expected square input size for the model, in pixels. */
  inputSize?: number;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): EmbedderConfig {
  return {
    ...(env['FACE_MODEL_PATH'] ? { modelPath: env['FACE_MODEL_PATH'] } : {}),
    ...(env['FACE_MODEL_NAME'] ? { modelName: env['FACE_MODEL_NAME'] } : {}),
    ...(env['FACE_MODEL_DIMENSIONS'] ? { dimensions: Number(env['FACE_MODEL_DIMENSIONS']) } : {}),
    ...(env['FACE_MODEL_INPUT_SIZE'] ? { inputSize: Number(env['FACE_MODEL_INPUT_SIZE']) } : {}),
  };
}

/**
 * The model the person store is in, from configuration.
 *
 * Available without any runtime: naming the space is not the same as being
 * able to compute in it, and a device that *can* needs to be told which one.
 */
export function canonicalModel(config: EmbedderConfig): EmbeddingModel | undefined {
  const model = config.modelName?.trim();
  const dimensions = config.dimensions;
  if (!model || !Number.isInteger(dimensions) || !(dimensions! > 0)) return undefined;
  return { model, dimensions: dimensions! };
}

/** What to tell somebody who asked for an embedding we cannot produce. */
export function whyNotAvailable(config: EmbedderConfig): string {
  if (!canonicalModel(config)) {
    return 'Face recognition is not set up on this runner: no model is named. '
      + 'Set FACE_MODEL_NAME and FACE_MODEL_DIMENSIONS, and either install a '
      + 'runtime here or use a device that can embed faces itself.';
  }
  if (!config.modelPath) {
    return 'This runner names a face model but cannot run it, so a device has to '
      + 'do the embedding. The device in use cannot, so there is no way to '
      + 'recognise anybody from here.';
  }
  return 'The face model could not be loaded. Check FACE_MODEL_PATH and that '
    + 'onnxruntime-node is installed.';
}

/**
 * Build an embedder, or null when one is not configured or not installed.
 *
 * Never throws for want of a runtime: a runner with no face model is a normal
 * runner, not a broken one.
 */
export async function createEmbedder(config: EmbedderConfig): Promise<FaceEmbedder | null> {
  const model = canonicalModel(config);
  if (!model || !config.modelPath) return null;

  let ort: OnnxRuntime;
  try {
    // Dynamic, so the dependency stays optional. A static import would make
    // every runner carry 300MB for a feature most never use.
    ort = (await import('onnxruntime-node' as string)) as unknown as OnnxRuntime;
  } catch {
    log.warn('[Face] A model is configured but onnxruntime-node is not installed — '
      + 'install it to embed faces on the runner, or let the device do it.');
    return null;
  }

  try {
    const session = await ort.InferenceSession.create(config.modelPath);
    log.info(`[Face] Embedding with ${model.model} (${model.dimensions}d) from ${config.modelPath}`);
    return new OnnxFaceEmbedder(ort, session, model, config.inputSize ?? 112);
  } catch (err) {
    log.warn(`[Face] Could not load ${config.modelPath}: ${(err as Error).message}`);
    return null;
  }
}

// ── The ONNX implementation ──────────────────────────────────────────────────

/** Only the parts of onnxruntime-node we use, so this file still typechecks without it. */
interface OnnxRuntime {
  InferenceSession: {
    create(path: string): Promise<OnnxSession>;
  };
  Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown;
}

interface OnnxSession {
  inputNames: string[];
  outputNames: string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: ArrayLike<number> }>>;
}

class OnnxFaceEmbedder implements FaceEmbedder {
  constructor(
    private readonly ort: OnnxRuntime,
    private readonly session: OnnxSession,
    readonly model: EmbeddingModel,
    private readonly inputSize: number,
  ) {}

  async embed(image: Buffer): Promise<number[] | null> {
    const pixels = await decodeToSquareRgb(image, this.inputSize);
    if (!pixels) return null;

    const input = this.session.inputNames[0];
    const output = this.session.outputNames[0];
    if (!input || !output) return null;

    const tensor = new this.ort.Tensor('float32', pixels, [1, 3, this.inputSize, this.inputSize]);
    const result = await this.session.run({ [input]: tensor });
    const data = result[output]?.data;
    if (!data) return null;

    const vector = Array.from(data as ArrayLike<number>);
    return vector.length === this.model.dimensions ? vector : null;
  }
}

/**
 * Decode an image to a square CHW float tensor.
 *
 * Deliberately a stub with a clear failure rather than a half-correct JPEG
 * decoder: getting the colour order, the crop or the normalisation wrong
 * produces vectors that look fine and match nobody, which is the hardest kind
 * of bug to see. It wants a real image library, chosen alongside the model.
 */
async function decodeToSquareRgb(_image: Buffer, _size: number): Promise<Float32Array | null> {
  throw new Error(
    'Decoding an image for the face model is not implemented on the runner yet. '
    + 'Embed on the device instead, or add an image decoder matched to the model '
    + "you configured — the crop, channel order and normalisation have to match how "
    + 'it was trained, and guessing produces vectors that match nobody.',
  );
}
