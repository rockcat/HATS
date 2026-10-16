// ── What a device can actually do ─────────────────────────────────────────────
//
// Devices offering the same tools are not equivalent. A phone can turn a face
// into a vector in a few milliseconds; a browser tab showing the same avatar
// probably cannot, and a kiosk with no camera cannot do any of it. The runner
// has to know which it is talking to before it decides how to do a job, so a
// device declares capabilities as well as tools.
//
// This is a negotiation rather than a declaration, for one reason that is easy
// to miss and expensive to discover later: **two different models produce
// vectors that cannot be compared.** A face embedded by MobileFaceNet and the
// same face embedded by anything else are simply different numbers. So it is
// not enough for a device to say "I can embed faces" — it has to say which
// model, the runner has to agree, and whatever is stored has to record which
// model produced it. Otherwise the person store slowly fills with templates
// that can never match each other and nobody can tell why recognition got
// worse.

/** A model that turns a face into a vector. Vectors are comparable only within one. */
export interface EmbeddingModel {
  /** Stable id, e.g. `mobilefacenet-v1`. Compared exactly. */
  model: string;
  /** Length of the vector it produces. */
  dimensions: number;
}

/** What a device says it can do, beyond the tools it offers. */
export interface DeviceCapabilities {
  /** Face embedding models this device can run itself. */
  faceEmbedding?: EmbeddingModel[];
  /** Still capture, and from which lenses. */
  camera?: { lenses?: string[] };
  /** Speech handled on the device rather than through the runner. */
  speech?: { recognition?: boolean; synthesis?: boolean };
}

/** What the runner can do for itself, when a device cannot. */
export interface RunnerCapabilities {
  /** The model the runner embeds with. Anything stored is in this space. */
  faceEmbedding?: EmbeddingModel;
}

/** Where a piece of work should happen. */
export type Where = 'device' | 'runner' | 'nowhere';

export interface Negotiated {
  /**
   * Where a face should be turned into a vector.
   *
   * `device` keeps the face on the phone and sends a vector. `runner` means
   * sending the picture instead. `nowhere` means neither end can, and the
   * agent should be told rather than left calling a tool that cannot work.
   */
  faceEmbedding: Where;
  /** The model both ends agreed on, when there is one. */
  faceModel?: EmbeddingModel;
}

const sameModel = (a: EmbeddingModel, b: EmbeddingModel) =>
  a.model === b.model && a.dimensions === b.dimensions;

/**
 * Decide where each job happens, given what the device offers.
 *
 * The runner's model is canonical: it is the space the person store is in, so
 * a device may embed only if it runs that exact model. A device offering a
 * different one is not a disagreement to split the difference on — its vectors
 * would be meaningless here — so it falls back to sending pictures.
 */
export function negotiate(
  device: DeviceCapabilities | undefined,
  runner: RunnerCapabilities,
): Negotiated {
  const wanted = runner.faceEmbedding;
  if (!wanted) return { faceEmbedding: 'nowhere' };

  const onDevice = (device?.faceEmbedding ?? []).some((m) => sameModel(m, wanted));
  return {
    faceEmbedding: onDevice ? 'device' : 'runner',
    faceModel: wanted,
  };
}

/** Does this device claim a camera at all? */
export function hasCamera(device: DeviceCapabilities | undefined): boolean {
  return (device?.camera?.lenses ?? []).length > 0;
}

/**
 * Tidy what arrived over the wire.
 *
 * Everything here came from a client, so a malformed entry is dropped rather
 * than trusted: a model with no name or a nonsense dimension would otherwise
 * sit in the store poisoning comparisons.
 */
export function sanitise(raw: unknown): DeviceCapabilities {
  if (typeof raw !== 'object' || raw === null) return {};
  const input = raw as Record<string, unknown>;
  const result: DeviceCapabilities = {};

  const models = Array.isArray(input['faceEmbedding']) ? input['faceEmbedding'] : [];
  const valid = models
    .filter((m): m is Record<string, unknown> => typeof m === 'object' && m !== null)
    .map((m) => ({ model: String(m['model'] ?? '').trim(), dimensions: Number(m['dimensions']) }))
    .filter((m) => m.model !== '' && Number.isInteger(m.dimensions) && m.dimensions > 0);
  if (valid.length) result.faceEmbedding = valid;

  const camera = input['camera'];
  if (typeof camera === 'object' && camera !== null) {
    const lenses = (camera as Record<string, unknown>)['lenses'];
    const clean = Array.isArray(lenses)
      ? lenses.filter((l): l is string => typeof l === 'string' && l.trim() !== '')
      : [];
    if (clean.length) result.camera = { lenses: clean };
  }

  const speech = input['speech'];
  if (typeof speech === 'object' && speech !== null) {
    const s = speech as Record<string, unknown>;
    result.speech = {
      ...(typeof s['recognition'] === 'boolean' ? { recognition: s['recognition'] } : {}),
      ...(typeof s['synthesis'] === 'boolean' ? { synthesis: s['synthesis'] } : {}),
    };
    if (Object.keys(result.speech).length === 0) delete result.speech;
  }

  return result;
}
