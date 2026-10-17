// ── Tools that run in this tab ────────────────────────────────────────────────
//
// A browser is a device like any other: it has a camera, a clock and a
// microphone the runner has no route to. The runner asks over the event stream
// it is already listening on, and the answer goes back against the request's
// id.
//
// The same two rules the phone client follows, for the same reasons:
//
//  * **Declare only what works.** The agent is offered exactly what is
//    declared. A tool listed without the permission behind it becomes one it
//    calls repeatedly and never gets anything from.
//  * **Always answer.** A request left unanswered costs the agent a full
//    thirty-second wait before it learns nothing. Failing fast and saying why
//    is better than silence.

/** How long the camera stays warm after a photo, before the light goes out. */
export const CAMERA_IDLE_MS = 20_000;

/** What a tool produced: text the agent reads, and optionally a picture. */
export const result = (text, image) => ({ text, ...(image ? { image } : {}) });

/**
 * Hold the tools this tab offers and answer the runner's requests.
 *
 * Takes its browser bits as parameters rather than reaching for globals, so
 * the request handling can be tested without a camera.
 */
export class DeviceToolHost {
  /**
   * @param {object} options
   * @param {object} options.client      an EmbodimentClient
   * @param {string} options.deviceId    stable across reloads
   * @param {string} [options.label]     something recognisable in a log
   */
  constructor({ client, deviceId, label = 'browser' }) {
    this.client = client;
    this.deviceId = deviceId;
    this.label = label;
    this.tools = new Map();
    this.capabilities = {};
    this.agreed = {};
    /** Requests already running, so a retransmitted frame is not run twice —
     *  taking two photographs because a frame arrived twice is a poor surprise. */
    this.inFlight = new Set();
  }

  add(tool) { this.tools.set(tool.name, tool); return this; }
  remove(name) { this.tools.delete(name); }
  has(name) { return this.tools.has(name); }

  /** Tell the runner what is here. Safe to call again at any time. */
  async declare() {
    try {
      this.agreed = await this.client.declareDevice(
        this.deviceId,
        [...this.tools.values()].map(({ name, description, parameters }) => ({
          name, description, ...(parameters ? { parameters } : {}),
        })),
        {
          label: this.label,
          ...(Object.keys(this.capabilities).length ? { capabilities: this.capabilities } : {}),
        },
      );
      return true;
    } catch {
      // Not fatal. The conversation works with no device tools at all.
      return false;
    }
  }

  async withdraw() {
    try { await this.client.withdrawDevice(this.deviceId); } catch { /* the stream closing drops us anyway */ }
  }

  /** Handle one `device_request` frame. Always posts an answer. */
  async handle(event) {
    const { id, tool: name, arguments: args } = event ?? {};
    if (!id || !name || this.inFlight.has(id)) return;
    this.inFlight.add(id);

    try {
      const tool = this.tools.get(name);
      if (!tool) {
        await this.answer(id, { ok: false, error: `This device does not offer "${name}".` });
        return;
      }
      const produced = await tool.run(args ?? {});
      await this.answer(id, {
        ok: true,
        result: produced?.text ?? 'Done.',
        ...(produced?.image ? { image: produced.image } : {}),
      });
    } catch (err) {
      // Whatever went wrong, the agent is told. Silence costs it the timeout
      // and teaches it nothing.
      await this.answer(id, { ok: false, error: String(err?.message ?? err) });
    } finally {
      this.inFlight.delete(id);
    }
  }

  async answer(id, body) {
    try { await this.client.sendDeviceResult(id, body); }
    catch { /* the runner will time it out; nothing better is available */ }
  }
}

// ── The tools themselves ─────────────────────────────────────────────────────

/** Needs no permission and no hardware, so it proves the round trip alone. */
export const deviceTimeTool = () => ({
  name: 'get_device_time',
  description: "The current local time where the user is, with its time zone. "
    + 'Useful when they say "this morning" or "tonight" and you need to know theirs.',
  run: async () => {
    const now = new Date();
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'unknown';
    return result(`${now.toISOString()} (${zone})`);
  },
});

/**
 * Take a photograph through the page's camera.
 *
 * `media` and `canvasFor` are injected so this can be tested without a webcam,
 * and so a caller can supply a stream it already holds rather than opening a
 * second one.
 */
export function cameraTool({ media = navigator.mediaDevices, canvasFor = defaultCanvas, onCapture } = {}) {
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

  const open = async (facing) => {
    if (stream) return;
    // `exact` would fail outright on a laptop with one camera; `ideal` asks
    // for the front or back and settles for what there is.
    stream = await media.getUserMedia({
      video: { facingMode: { ideal: facing === 'front' ? 'user' : 'environment' } },
      audio: false,
    });
    video = document.createElement('video');
    video.srcObject = stream;
    video.playsInline = true;
    video.muted = true;
    await video.play();
  };

  const capture = async (facing) => {
    try {
      await open(facing);
    } catch (err) {
      return result(explainCameraError(err));
    }

    try {
      const canvas = canvasFor(video.videoWidth || 640, video.videoHeight || 480);
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      // JPEG at 0.8: a 720p frame lands around 100KB, which is what the model
      // wants and a fraction of what a full-resolution PNG would cost.
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      if (!base64) return result('The camera returned an empty frame.');

      onCapture?.(facing);
      clearTimeout(idleTimer);
      idleTimer = setTimeout(stop, CAMERA_IDLE_MS);

      return result(
        `A photo from the ${facing === 'front' ? 'front' : 'back'} camera of the user's device.`,
        { mediaType: 'image/jpeg', base64 },
      );
    } catch (err) {
      stop();
      return result(`The photo could not be taken: ${err?.message ?? err}`);
    }
  };

  return {
    name: 'take_photo',
    description: "Take a photo with the camera on the user's device and look at it. "
      + 'Use this when they ask you to look at something, refer to something in front '
      + 'of them, or when seeing would answer a question better than asking. The photo '
      + 'is shown to you directly and is also saved to the project.',
    parameters: {
      type: 'object',
      properties: {
        lens: {
          type: 'string', enum: ['back', 'front'],
          description: 'Which camera. "back" to see what the user is looking at, '
            + '"front" to see the user. Defaults to back.',
        },
      },
    },
    run: async (args) => {
      // One capture at a time: two overlapping requests would fight over the
      // same stream and the second would lose with an opaque error.
      if (inFlight) return inFlight;
      const facing = String(args?.lens ?? 'back').toLowerCase().startsWith('front') ? 'front' : 'back';
      inFlight = capture(facing).finally(() => { inFlight = null; });
      return inFlight;
    },
    /** Release the camera — the page is closing. */
    close: stop,
  };
}

/** Say what a getUserMedia failure means, in terms the agent can act on. */
export function explainCameraError(err) {
  const name = err?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'The user has not given this page permission to use the camera. '
      + 'Ask them to allow it, then try again.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'This device has no camera available.';
  }
  if (name === 'NotReadableError') {
    return 'The camera is in use by something else on the device.';
  }
  return `The camera could not be started: ${err?.message ?? err}`;
}

function defaultCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * A device id that survives a reload but is not shared between browsers.
 *
 * Reusing it matters: a fresh id on every reload leaves the runner holding a
 * list of devices that no longer exist, each still advertising a camera.
 */
export function deviceId(storage = window.localStorage) {
  const KEY = 'hats.companion.deviceId';
  try {
    const existing = storage.getItem(KEY);
    if (existing) return existing;
    const made = `browser-${crypto.randomUUID()}`;
    storage.setItem(KEY, made);
    return made;
  } catch {
    // Private window, or storage blocked. A per-session id still works; it
    // just leaves a stale entry behind on reload.
    return `browser-${crypto.randomUUID()}`;
  }
}
