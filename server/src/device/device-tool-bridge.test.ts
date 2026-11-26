import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DeviceToolBridge, DEVICE_PREFIX, type DeviceRequest } from './device-tool-bridge.js';

const PHOTO = { name: 'take_photo', description: 'Take a photo with the camera.' };
const TIME = { name: 'get_device_time', description: "The device's local time." };

/** Collects what was sent to each device, and can refuse delivery. */
function makeBridge({ timeoutMs = 1000, deliverable = true } = {}) {
  const sent: Array<{ deviceId: string; request: DeviceRequest }> = [];
  const bridge = new DeviceToolBridge({
    timeoutMs,
    deliver: (deviceId, request) => {
      sent.push({ deviceId, request });
      return deliverable;
    },
  });
  return { bridge, sent };
}

describe('what the model is offered', () => {
  it('offers nothing when no device is connected', () => {
    // A tool that cannot possibly work is worse than an absent one: the agent
    // will keep calling it.
    const { bridge } = makeBridge();
    expect(bridge.toolDefinitions()).toEqual([]);
    expect(bridge.isDeviceTool('device__take_photo')).toBe(false);
  });

  it('offers what a connected device declared, namespaced', () => {
    const { bridge } = makeBridge();
    bridge.register('phone', [PHOTO]);
    expect(bridge.toolDefinitions().map((t) => t.name)).toEqual(['device__take_photo']);
    expect(bridge.isDeviceTool('device__take_photo')).toBe(true);
  });

  it('keeps the description, which is all the model has to go on', () => {
    const { bridge } = makeBridge();
    bridge.register('phone', [PHOTO]);
    expect(bridge.toolDefinitions()[0]?.description).toBe(PHOTO.description);
  });

  it('gives a tool with no parameters a valid empty schema', () => {
    const { bridge } = makeBridge();
    bridge.register('phone', [TIME]);
    expect(bridge.toolDefinitions()[0]?.parameters).toEqual({ type: 'object', properties: {} });
  });

  it('passes a declared schema through untouched', () => {
    const { bridge } = makeBridge();
    bridge.register('phone', [{
      ...PHOTO,
      parameters: {
        type: 'object' as const,
        properties: { facing: { type: 'string', description: 'front or back' } },
        required: ['facing'],
      },
    }]);
    expect(bridge.toolDefinitions()[0]?.parameters.required).toEqual(['facing']);
  });

  it('does not offer the same tool twice when two devices have it', () => {
    const { bridge } = makeBridge();
    bridge.register('phone', [PHOTO]);
    bridge.register('tablet', [PHOTO]);
    expect(bridge.toolDefinitions()).toHaveLength(1);
  });

  it('stops offering a tool once its device disconnects', () => {
    const { bridge } = makeBridge();
    bridge.register('phone', [PHOTO]);
    bridge.unregister('phone');
    expect(bridge.toolDefinitions()).toEqual([]);
  });

  it('replaces the list when a device re-declares, rather than merging', () => {
    // A device that lost camera permission must stop offering the camera.
    const { bridge } = makeBridge();
    bridge.register('phone', [PHOTO, TIME]);
    bridge.register('phone', [TIME]);
    expect(bridge.toolDefinitions().map((t) => t.name)).toEqual(['device__get_device_time']);
  });

  it('ignores a declaration with no name', () => {
    const { bridge } = makeBridge();
    bridge.register('phone', [{ name: '  ', description: 'nameless' }, TIME]);
    expect(bridge.toolDefinitions()).toHaveLength(1);
  });
});

describe('calling a device tool', () => {
  it('sends the request to the device that has the tool', async () => {
    const { bridge, sent } = makeBridge();
    bridge.register('phone', [PHOTO]);
    const call = bridge.call('device__take_photo', { facing: 'front' });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.deviceId).toBe('phone');
    expect(sent[0]?.request.tool).toBe('take_photo');
    expect(sent[0]?.request.arguments).toEqual({ facing: 'front' });

    bridge.settleResult(sent[0]!.request.id, { ok: true, result: 'a cup of tea' });
    expect((await call).text).toBe('a cup of tea');
  });

  it('strips the namespace, because the device never sees it', async () => {
    const { bridge, sent } = makeBridge();
    bridge.register('phone', [PHOTO]);
    const call = bridge.call(`${DEVICE_PREFIX}take_photo`);
    expect(sent[0]?.request.tool).toBe('take_photo');
    bridge.settleResult(sent[0]!.request.id, { ok: true, result: 'ok' });
    await call;
  });

  it('tells the agent plainly when no device has the tool', async () => {
    const { bridge, sent } = makeBridge();
    expect((await bridge.call('device__take_photo')).text).toContain('No connected device');
    expect(sent).toHaveLength(0);
  });

  it('reports a failure the device described, rather than pretending it worked', async () => {
    const { bridge, sent } = makeBridge();
    bridge.register('phone', [PHOTO]);
    const call = bridge.call('device__take_photo');
    bridge.settleResult(sent[0]!.request.id, { ok: false, error: 'camera permission denied' });
    expect((await call).text).toContain('camera permission denied');
  });

  it('says something useful when the device answers ok with no detail', async () => {
    const { bridge, sent } = makeBridge();
    bridge.register('phone', [TIME]);
    const call = bridge.call('device__get_device_time');
    bridge.settleResult(sent[0]!.request.id, { ok: true });
    expect((await call).text).toBe('Done.');
  });

  it('gives up when the device cannot be reached at all', async () => {
    const { bridge } = makeBridge({ deliverable: false });
    bridge.register('phone', [PHOTO]);
    expect((await bridge.call('device__take_photo')).text).toContain('Could not reach the device');
  });

  it('prefers the most recently connected device, which is the one in your hand', async () => {
    const { bridge, sent } = makeBridge();
    bridge.register('old-phone', [PHOTO]);
    bridge.register('new-phone', [PHOTO]);
    const call = bridge.call('device__take_photo');
    expect(sent[0]?.deviceId).toBe('new-phone');
    bridge.settleResult(sent[0]!.request.id, { ok: true, result: 'x' });
    await call;
  });

  it('keeps concurrent calls apart', async () => {
    const { bridge, sent } = makeBridge();
    bridge.register('phone', [PHOTO, TIME]);
    const photo = bridge.call('device__take_photo');
    const time = bridge.call('device__get_device_time');

    // Answered out of order, which is the normal case over a network.
    bridge.settleResult(sent[1]!.request.id, { ok: true, result: 'half past three' });
    bridge.settleResult(sent[0]!.request.id, { ok: true, result: 'a photo' });

    expect((await photo).text).toBe('a photo');
    expect((await time).text).toBe('half past three');
  });

  it('carries an expiry the device can see', () => {
    const { bridge, sent } = makeBridge({ timeoutMs: 5000 });
    bridge.register('phone', [PHOTO]);
    void bridge.call('device__take_photo');
    const expires = Date.parse(sent[0]!.request.expiresAt);
    expect(expires).toBeGreaterThan(Date.now());
    expect(expires).toBeLessThanOrEqual(Date.now() + 5000);
  });
});

describe('when the device does not answer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('times out rather than leaving the agent waiting for ever', async () => {
    const { bridge } = makeBridge({ timeoutMs: 1000 });
    bridge.register('phone', [PHOTO]);
    const call = bridge.call('device__take_photo');
    await vi.advanceTimersByTimeAsync(1001);
    expect((await call).text).toContain('did not answer');
  });

  it('ignores an answer that arrives after the timeout', async () => {
    const { bridge, sent } = makeBridge({ timeoutMs: 1000 });
    bridge.register('phone', [PHOTO]);
    const call = bridge.call('device__take_photo');
    await vi.advanceTimersByTimeAsync(1001);
    await call;
    expect(bridge.settleResult(sent[0]!.request.id, { ok: true, result: 'late' })).toBe(false);
  });

  it('fails a call immediately when its device disconnects', async () => {
    // A clear answer now beats the same answer thirty seconds from now.
    const { bridge } = makeBridge({ timeoutMs: 30_000 });
    bridge.register('phone', [PHOTO]);
    const call = bridge.call('device__take_photo');
    bridge.unregister('phone');
    expect((await call).text).toContain('went offline');
  });

  it('settles everything in flight when the runner stops', async () => {
    const { bridge } = makeBridge({ timeoutMs: 30_000 });
    bridge.register('phone', [PHOTO]);
    const call = bridge.call('device__take_photo');
    bridge.close();
    expect((await call).text).toContain('runner stopped');
  });
});

describe('settleResult', () => {
  it('reports an id nobody is waiting for', () => {
    const { bridge } = makeBridge();
    expect(bridge.settleResult('made-up-id', { ok: true, result: 'x' })).toBe(false);
  });
});

describe('connected', () => {
  it('lists what is attached, for the operator', () => {
    const { bridge } = makeBridge();
    bridge.register('phone', [PHOTO, TIME], "Paul's phone");
    expect(bridge.connected()).toMatchObject([
      { deviceId: 'phone', label: "Paul's phone", tools: ['take_photo', 'get_device_time'] },
    ]);
  });
});

// ── Pictures ─────────────────────────────────────────────────────────────────

/** A bridge that records what it was asked to keep, and where it says it went. */
function makeBridgeWithKeeper(kept: string | null = 'outputs/device/photo.jpg') {
  const asked: Array<{ tool: string; bytes: number }> = [];
  const sent: Array<{ deviceId: string; request: DeviceRequest }> = [];
  const bridge = new DeviceToolBridge({
    timeoutMs: 1000,
    deliver: (deviceId, request) => { sent.push({ deviceId, request }); return true; },
    keepImage: async (tool, image) => {
      asked.push({ tool, bytes: image.base64.length });
      return kept;
    },
  });
  return { bridge, sent, asked };
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');

describe('a device tool that took a picture', () => {
  it('passes the image to the model, not just a description of it', async () => {
    // Describing it in words would mean something else had done the looking.
    const { bridge, sent } = makeBridgeWithKeeper();
    bridge.register('phone', [PHOTO]);
    const call = bridge.call(DEVICE_PREFIX + 'take_photo');
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    bridge.settleResult(sent[0]!.request.id, {
      ok: true, result: 'A mug on a desk.', image: { mediaType: 'image/jpeg', base64: JPEG },
    });

    const outcome = await call;
    expect(outcome.images).toHaveLength(1);
    expect(outcome.images?.[0]?.base64).toBe(JPEG);
    expect(outcome.images?.[0]?.mediaType).toBe('image/jpeg');
  });

  it('tells the agent where it was kept, so it can look again later', async () => {
    const { bridge, sent, asked } = makeBridgeWithKeeper('outputs/device/2026-mug.jpg');
    bridge.register('phone', [PHOTO]);
    const call = bridge.call(DEVICE_PREFIX + 'take_photo');
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    bridge.settleResult(sent[0]!.request.id, {
      ok: true, result: 'A mug on a desk.', image: { mediaType: 'image/jpeg', base64: JPEG },
    });

    const outcome = await call;
    expect(asked).toEqual([{ tool: 'take_photo', bytes: JPEG.length }]);
    expect(outcome.text).toContain('A mug on a desk.');
    expect(outcome.text).toContain('outputs/device/2026-mug.jpg');
    expect(outcome.images?.[0]?.path).toBe('outputs/device/2026-mug.jpg');
  });

  it('still shows the picture when it could not be kept', async () => {
    // A full disk should cost the copy, not the answer.
    const { bridge, sent } = makeBridgeWithKeeper(null);
    bridge.register('phone', [PHOTO]);
    const call = bridge.call(DEVICE_PREFIX + 'take_photo');
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    bridge.settleResult(sent[0]!.request.id, {
      ok: true, image: { mediaType: 'image/jpeg', base64: JPEG },
    });

    const outcome = await call;
    expect(outcome.images).toHaveLength(1);
    expect(outcome.text).not.toContain('Kept at');
  });

  it('survives a keeper that throws', async () => {
    const sent: Array<{ deviceId: string; request: DeviceRequest }> = [];
    const bridge = new DeviceToolBridge({
      timeoutMs: 1000,
      deliver: (deviceId, request) => { sent.push({ deviceId, request }); return true; },
      keepImage: async () => { throw new Error('disk full'); },
    });
    bridge.register('phone', [PHOTO]);
    const call = bridge.call(DEVICE_PREFIX + 'take_photo');
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    bridge.settleResult(sent[0]!.request.id, {
      ok: true, image: { mediaType: 'image/jpeg', base64: JPEG },
    });

    expect((await call).images).toHaveLength(1);
  });

  it('drops an image too large to send, and says why', async () => {
    // Anthropic fails the whole request over an oversized image, which would
    // cost the agent the answer as well as the picture.
    const { bridge, sent } = makeBridgeWithKeeper();
    bridge.register('phone', [PHOTO]);
    const call = bridge.call(DEVICE_PREFIX + 'take_photo');
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    bridge.settleResult(sent[0]!.request.id, {
      ok: true, result: 'A mug.', image: { mediaType: 'image/jpeg', base64: 'A'.repeat(9_000_000) },
    });

    const outcome = await call;
    expect(outcome.images).toBeUndefined();
    expect(outcome.text).toContain('A mug.');
    expect(outcome.text).toContain('too large');
  });

  it('drops an image in a format no model takes, and says which', async () => {
    const { bridge, sent } = makeBridgeWithKeeper();
    bridge.register('phone', [PHOTO]);
    const call = bridge.call(DEVICE_PREFIX + 'take_photo');
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    bridge.settleResult(sent[0]!.request.id, {
      ok: true, image: { mediaType: 'image/heic', base64: JPEG },
    });

    const outcome = await call;
    expect(outcome.images).toBeUndefined();
    expect(outcome.text).toContain('image/heic');
  });

  it('does not try to keep anything when the device reported a failure', async () => {
    const { bridge, sent, asked } = makeBridgeWithKeeper();
    bridge.register('phone', [PHOTO]);
    const call = bridge.call(DEVICE_PREFIX + 'take_photo');
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    bridge.settleResult(sent[0]!.request.id, { ok: false, error: 'camera permission denied' });

    expect((await call).text).toContain('camera permission denied');
    expect(asked).toEqual([]);
  });

  it('leaves a tool that returns no picture exactly as it was', async () => {
    const { bridge, sent } = makeBridgeWithKeeper();
    bridge.register('phone', [TIME]);
    const call = bridge.call(DEVICE_PREFIX + 'get_device_time');
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    bridge.settleResult(sent[0]!.request.id, { ok: true, result: 'half past three' });

    const outcome = await call;
    expect(outcome).toEqual({ text: 'half past three' });
  });
});

// ── Asking a device for something the agent must not read ────────────────────

const FACE = { name: 'embed_face', description: 'Turn the face in view into a vector.' };

describe('askForData', () => {
  it('hands back what the device sent, not a sentence about it', async () => {
    const { bridge, sent } = makeBridge();
    bridge.register('phone', [FACE]);

    const asked = bridge.askForData<number[]>('embed_face');
    bridge.settleResult(sent[0]!.request.id, { ok: true, data: [0.1, 0.2, 0.3] });

    expect(await asked).toEqual({ ok: true, data: [0.1, 0.2, 0.3] });
  });

  it('works through the device__ prefix as well as without it', async () => {
    const { bridge, sent } = makeBridge();
    bridge.register('phone', [FACE]);

    const asked = bridge.askForData<number[]>(`${DEVICE_PREFIX}embed_face`);
    bridge.settleResult(sent[0]!.request.id, { ok: true, data: [1] });
    expect(await asked).toEqual({ ok: true, data: [1] });
  });

  it('fails rather than hang when no device offers it', async () => {
    const { bridge } = makeBridge();
    const answer = await bridge.askForData('embed_face');
    expect(answer.ok).toBe(false);
  });

  it('fails when the device ran it but sent nothing back', async () => {
    // Silence read as an empty vector would match everybody.
    const { bridge, sent } = makeBridge();
    bridge.register('phone', [FACE]);

    const asked = bridge.askForData('embed_face');
    bridge.settleResult(sent[0]!.request.id, { ok: true, result: 'Done.' });

    const answer = await asked;
    expect(answer.ok).toBe(false);
    expect(answer.ok === false && answer.error).toMatch(/no data/i);
  });

  it('passes the device error through', async () => {
    const { bridge, sent } = makeBridge();
    bridge.register('phone', [FACE]);

    const asked = bridge.askForData('embed_face');
    bridge.settleResult(sent[0]!.request.id, { ok: false, error: 'The camera is covered.' });

    const answer = await asked;
    expect(answer.ok).toBe(false);
    expect(answer.ok === false && answer.error).toContain('camera is covered');
  });

  it('settles when the device never answers', async () => {
    // Without this the people tools wait for ever on a tab that was closed
    // mid-request.
    const { bridge } = makeBridge({ timeoutMs: 5 });
    bridge.register('phone', [FACE]);

    const answer = await bridge.askForData('embed_face');
    expect(answer.ok).toBe(false);
    expect(answer.ok === false && answer.error).toMatch(/did not answer/i);
  });

  it('settles when the device cannot be reached at all', async () => {
    const { bridge } = makeBridge({ deliverable: false });
    bridge.register('phone', [FACE]);

    const answer = await bridge.askForData('embed_face');
    expect(answer.ok).toBe(false);
  });

  it('keeps the data away from an agent calling the same tool', async () => {
    const { bridge, sent } = makeBridge();
    bridge.register('phone', [FACE]);

    const called = bridge.call(`${DEVICE_PREFIX}embed_face`);
    bridge.settleResult(sent[0]!.request.id, { ok: true, result: 'Looked.', data: [0.1, 0.2] });

    const outcome = await called;
    expect(outcome.text).toBe('Looked.');
    expect(JSON.stringify(outcome)).not.toContain('0.1');
  });
});
