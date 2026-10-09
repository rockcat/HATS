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
    expect(await call).toBe('a cup of tea');
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
    expect(await bridge.call('device__take_photo')).toContain('No connected device');
    expect(sent).toHaveLength(0);
  });

  it('reports a failure the device described, rather than pretending it worked', async () => {
    const { bridge, sent } = makeBridge();
    bridge.register('phone', [PHOTO]);
    const call = bridge.call('device__take_photo');
    bridge.settleResult(sent[0]!.request.id, { ok: false, error: 'camera permission denied' });
    expect(await call).toContain('camera permission denied');
  });

  it('says something useful when the device answers ok with no detail', async () => {
    const { bridge, sent } = makeBridge();
    bridge.register('phone', [TIME]);
    const call = bridge.call('device__get_device_time');
    bridge.settleResult(sent[0]!.request.id, { ok: true });
    expect(await call).toBe('Done.');
  });

  it('gives up when the device cannot be reached at all', async () => {
    const { bridge } = makeBridge({ deliverable: false });
    bridge.register('phone', [PHOTO]);
    expect(await bridge.call('device__take_photo')).toContain('Could not reach the device');
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

    expect(await photo).toBe('a photo');
    expect(await time).toBe('half past three');
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
    expect(await call).toContain('did not answer');
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
    expect(await call).toContain('went offline');
  });

  it('settles everything in flight when the runner stops', async () => {
    const { bridge } = makeBridge({ timeoutMs: 30_000 });
    bridge.register('phone', [PHOTO]);
    const call = bridge.call('device__take_photo');
    bridge.close();
    expect(await call).toContain('runner stopped');
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
    expect(bridge.connected()).toEqual([
      { deviceId: 'phone', label: "Paul's phone", tools: ['take_photo', 'get_device_time'] },
    ]);
  });
});
