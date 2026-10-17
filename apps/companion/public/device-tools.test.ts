import { describe, it, expect, beforeEach } from 'vitest';
// @ts-expect-error — a browser module; the parts tested here touch no DOM.
import { DeviceToolHost, deviceId, deviceTimeTool, explainCameraError, result } from './device-tools.js';

/** Records what was sent, and can be made to fail like an offline runner. */
class FakeClient {
  declared: unknown[] = [];
  results: Array<Record<string, unknown>> = [];
  withdrawals = 0;
  reachable = true;

  async declareDevice(deviceIdArg: string, tools: unknown[], options: Record<string, unknown>) {
    if (!this.reachable) throw new Error('unreachable');
    this.declared.push({ deviceId: deviceIdArg, tools, ...options });
    return { faceEmbedding: 'runner' };
  }

  async withdrawDevice() {
    if (!this.reachable) throw new Error('unreachable');
    this.withdrawals++;
  }

  async sendDeviceResult(id: string, body: Record<string, unknown>) {
    if (!this.reachable) throw new Error('unreachable');
    this.results.push({ id, ...body });
  }

  get last() { return this.results[this.results.length - 1]!; }
}

let client: FakeClient;
let host: InstanceType<typeof DeviceToolHost>;

beforeEach(() => {
  client = new FakeClient();
  host = new DeviceToolHost({ client, deviceId: 'dev-1', label: 'test browser' });
});

const request = (tool: string, args?: unknown, id = 'r1') => ({ id, tool, arguments: args });

describe('declaring what this tab offers', () => {
  it('sends the tools and the label', async () => {
    host.add(deviceTimeTool());
    expect(await host.declare()).toBe(true);

    const sent = client.declared[0] as Record<string, never>;
    expect(sent['label']).toBe('test browser');
    expect((sent['tools'] as Array<{ name: string }>)[0]?.name).toBe('get_device_time');
  });

  it('sends capabilities only when there are some', async () => {
    host.add(deviceTimeTool());
    await host.declare();
    expect((client.declared[0] as Record<string, unknown>)['capabilities']).toBeUndefined();

    host.capabilities = { camera: { lenses: ['front'] } };
    await host.declare();
    expect((client.declared[1] as Record<string, unknown>)['capabilities'])
      .toEqual({ camera: { lenses: ['front'] } });
  });

  it('keeps what the runner agreed', async () => {
    await host.declare();
    expect(host.agreed.faceEmbedding).toBe('runner');
  });

  it('treats an unreachable runner as not fatal', async () => {
    // The conversation works with no device tools at all.
    client.reachable = false;
    expect(await host.declare()).toBe(false);
  });
});

describe('answering a request', () => {
  it('runs the tool and sends what it produced', async () => {
    host.add({ name: 'ping', description: 'Pong.', run: async () => result('pong') });
    await host.handle(request('ping'));

    expect(client.last['ok']).toBe(true);
    expect(client.last['result']).toBe('pong');
  });

  it('passes the arguments through', async () => {
    let seen: unknown;
    host.add({ name: 'echo', description: 'Echo.', run: async (args: unknown) => { seen = args; return result('ok'); } });
    await host.handle(request('echo', { text: 'hello' }));

    expect(seen).toEqual({ text: 'hello' });
  });

  it('sends an image when the tool produced one', async () => {
    host.add({
      name: 'snap', description: 'Snap.',
      run: async () => result('a photo', { mediaType: 'image/jpeg', base64: 'abc' }),
    });
    await host.handle(request('snap'));

    expect(client.last['image']).toEqual({ mediaType: 'image/jpeg', base64: 'abc' });
  });

  it('says so when it does not have the tool', async () => {
    // Rather than silence, which costs the agent the full timeout.
    await host.handle(request('make_tea'));

    expect(client.last['ok']).toBe(false);
    expect(client.last['error']).toContain('does not offer "make_tea"');
  });

  it('reports a tool that threw, rather than going quiet', async () => {
    host.add({ name: 'bad', description: 'Bad.', run: async () => { throw new Error('it broke'); } });
    await host.handle(request('bad'));

    expect(client.last['ok']).toBe(false);
    expect(client.last['error']).toContain('it broke');
  });

  it('runs a retransmitted request only once', async () => {
    // Taking two photographs because a frame arrived twice is a poor surprise.
    let runs = 0;
    host.add({
      name: 'count', description: 'Count.',
      run: async () => { runs++; await new Promise((r) => setTimeout(r, 10)); return result('done'); },
    });

    await Promise.all([host.handle(request('count', {}, 'same')), host.handle(request('count', {}, 'same'))]);
    expect(runs).toBe(1);
  });

  it('runs the same tool again for a different request', async () => {
    let runs = 0;
    host.add({ name: 'count', description: 'Count.', run: async () => { runs++; return result('done'); } });

    await host.handle(request('count', {}, 'a'));
    await host.handle(request('count', {}, 'b'));
    expect(runs).toBe(2);
  });

  it('ignores a frame with no id or no tool', async () => {
    await host.handle({ tool: 'ping' });
    await host.handle({ id: 'r1' });
    await host.handle(undefined);

    expect(client.results).toHaveLength(0);
  });

  it('does not throw when the answer cannot be delivered', async () => {
    host.add({ name: 'ping', description: 'Pong.', run: async () => result('pong') });
    client.reachable = false;

    await expect(host.handle(request('ping'))).resolves.toBeUndefined();
  });
});

describe('the clock', () => {
  it('reports a time and a zone', async () => {
    const produced = await deviceTimeTool().run({});
    expect(produced.text).toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(produced.text).toContain('(');
  });
});

describe('explaining why the camera would not start', () => {
  it('names the fix for a refused permission', () => {
    // "Failed" invites a retry; naming the fix does not.
    const text = explainCameraError({ name: 'NotAllowedError' });
    expect(text).toContain('permission');
    expect(text).toContain('Ask them');
  });

  it('distinguishes a device with no camera', () => {
    expect(explainCameraError({ name: 'NotFoundError' })).toContain('no camera');
  });

  it('distinguishes a camera another app is holding', () => {
    expect(explainCameraError({ name: 'NotReadableError' })).toContain('in use');
  });

  it('falls back to whatever the browser said', () => {
    expect(explainCameraError({ name: 'WeirdError', message: 'something odd' }))
      .toContain('something odd');
  });
});

describe('the id this tab uses', () => {
  it('survives a reload', () => {
    // A fresh id each time leaves the runner holding devices that no longer
    // exist, each still advertising a camera.
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
    };

    expect(deviceId(storage)).toBe(deviceId(storage));
  });

  it('still works when storage is blocked', () => {
    // A private window, or site data turned off.
    const blocked = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };

    expect(deviceId(blocked)).toMatch(/^browser-/);
  });
});
