// ── The device tool that recognises a face ───────────────────────────────────
//
// What the runner asks this tab for when an agent calls `identify_person`.
// The camera opens, LiteRT turns the largest face into a vector, and the
// vector goes back on the `data` channel — not in the sentence the agent
// reads, because 192 floats are no use to a language model and would cost two
// kilobytes of its context to say nothing.
//
// The face itself never leaves the browser. That is the whole reason for
// running the model here rather than posting a photograph to the runner, and
// it is worth not quietly giving up: if the model cannot load, this tool is
// not declared at all, so the capability exchange reports honestly that
// nothing here can embed a face.

import { FaceEmbedder, canEmbedFaces } from '/ui-kit/face-runtime.js';
import { MOBILEFACENET } from '/ui-kit/face-embedding.js';

/** How long the camera stays open after the last look. */
const IDLE_MS = 8000;

/**
 * Build the tool, or return null when this browser cannot run the model.
 *
 * Checked by actually loading it rather than by feature detection: the usual
 * reason it cannot is a missing model file, which no amount of probing the
 * browser would reveal.
 *
 * @param {object} [options]
 * @param {MediaDevices} [options.media]
 * @param {object} [options.sources]  override where the models come from
 * @param {(message: string) => void} [options.onProblem]
 * @returns {Promise<object | null>}
 */
export async function faceTool({ media = navigator.mediaDevices, sources, onProblem } = {}) {
  if (!canEmbedFaces()) return null;

  const embedder = new FaceEmbedder({
    ...(sources ? { sources } : {}),
    onProblem: onProblem ?? (() => {}),
  });
  // Loaded up front, so the capability we declare is one we actually have.
  // The alternative — declaring it and finding out on first use — tells the
  // runner to stop sending photographs to a tab that cannot do the work.
  if (!await embedder.load()) return null;

  let stream = null;
  let video = null;
  let idleTimer = null;
  let inFlight = null;

  const stop = () => {
    clearTimeout(idleTimer);
    idleTimer = null;
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
    video = null;
  };

  const open = async () => {
    if (stream) return;
    // The front camera: this is for looking at whoever is talking, not at
    // what they are holding.
    stream = await media.getUserMedia({
      video: { facingMode: { ideal: 'user' } },
      audio: false,
    });
    video = document.createElement('video');
    video.srcObject = stream;
    video.playsInline = true;
    video.muted = true;
    await video.play();
  };

  const look = async () => {
    try {
      await open();
    } catch (err) {
      return { ok: false, error: cameraProblem(err) };
    }

    try {
      const found = await embedder.embed(video);
      clearTimeout(idleTimer);
      idleTimer = setTimeout(stop, IDLE_MS);

      if (!found.vector) return { ok: false, error: found.reason };
      return {
        ok: true,
        // Read by the runner's people tools, never by the agent.
        data: found.vector,
        // What the agent is told, if it is told anything: a fact about the
        // looking, not about the numbers.
        text: 'Had a look through the camera.',
      };
    } catch (err) {
      return { ok: false, error: `Could not read the face: ${err?.message ?? err}` };
    }
  };

  return {
    name: 'embed_face',
    description:
      'Look through the camera and turn the face in front of it into a vector '
      + 'the runner can match. You do not normally call this yourself — '
      + 'identify_person and remember_person use it for you.',
    parameters: { type: 'object', properties: {} },

    /** What the device-tool bridge expects back. */
    run: async () => {
      // One look at a time: two overlapping requests would fight over the
      // same camera and the second would lose with an opaque error.
      if (inFlight) return inFlight;
      inFlight = look().finally(() => { inFlight = null; });
      const answer = await inFlight;
      if (!answer.ok) throw new Error(answer.error);
      return { text: answer.text, data: answer.data };
    },

    /** What to tell the runner this device can do. */
    capability: {
      faceEmbedding: [{ model: MOBILEFACENET.model, dimensions: MOBILEFACENET.dimensions }],
    },

    close: () => { stop(); embedder.close(); },
  };
}

/** Say what a getUserMedia failure means, in terms somebody can act on. */
function cameraProblem(err) {
  const name = err?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'The user has not allowed this page to use the camera, so I cannot see them.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'This device has no camera.';
  }
  if (name === 'NotReadableError') {
    return 'The camera is being used by something else.';
  }
  return `The camera could not be started: ${err?.message ?? err}`;
}
