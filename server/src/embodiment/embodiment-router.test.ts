/**
 * Drives the real router, so the wiring between the avatar catalogue and the
 * roster is exercised rather than assumed.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import type { IncomingMessage, ServerResponse } from 'http';
import { EmbodimentRouter, EMBODIMENT_BASE } from './embodiment-router.js';
import type { TeamOrchestrator } from '../orchestrator/orchestrator.js';
import type { SpeechGateway } from '../speech/speech-gateway.js';
import type { IAgent } from '../agent/iagent.js';
import { DeviceToolBridge } from '../device/device-tool-bridge.js';

const agent = (name: string, avatar: string | undefined, templateId?: string): IAgent => ({
  id: `inst-${name}`,
  name,
  hatType: ['white'],
  state: 'idle',
  config: {
    identity: { name, visualDescription: 'calm', avatar, voice: 'en_GB-alba-medium' },
    provider: { name: 'anthropic' },
    model: 'claude-haiku-4-5-20251001',
    ...(templateId && { templateId }),
  },
  getThreadSummary: () => ({ general: 0 }),
  getHourlyCost: () => 0,
  isCostIdled: () => false,
} as unknown as IAgent);

/** Captures what a handler writes, so a route can be called without a socket. */
function capture() {
  const chunks: string[] = [];
  const sink = {
    statusCode: 0,
    headersSent: false,
    writeHead(status: number) { sink.statusCode = status; return sink; },
    write(chunk: string) { chunks.push(chunk); return true; },
    end(chunk?: string) { if (chunk) chunks.push(chunk); return sink; },
    on() { return sink; },
  };
  return {
    res: sink as unknown as ServerResponse,
    body: () => JSON.parse(chunks.join('')),
    status: () => sink.statusCode,
  };
}

let dir = '';
let router: EmbodimentRouter;
let devices: DeviceToolBridge;
/** What the bridge tried to send to a device, so delivery can be asserted. */
let delivered: Array<{ deviceId: string; tool: string; id: string }>;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'hats-router-'));
  await writeFile(path.join(dir, 'avatars.json'), JSON.stringify({
    avatars: [{ name: 'Max', file: 'max.glb', camera: [0, 1.7, 0.55], rotate: [0, 0, 0], fov: 44, scale: 1 }],
  }));

  const agents = [agent('Poppy', 'max.glb', 'tpl-poppy'), agent('Amara', 'dave.glb'), agent('Blake', undefined)];

  delivered = [];
  devices = new DeviceToolBridge({
    timeoutMs: 500,
    deliver: (deviceId, request) => {
      delivered.push({ deviceId, tool: request.tool, id: request.id });
      return true;
    },
    runner: { faceEmbedding: { model: 'mobilefacenet-v1', dimensions: 192 } },
  });

  router = new EmbodimentRouter({
    getOrchestrator: () => ({
      listAgents: () => agents,
      findById: (id: string) => agents.find((a) => a.id === id),
      agentIdForName: (name: string) => agents.find((a) => a.name === name)?.id,
    }) as unknown as TeamOrchestrator,
    getProjectContext: () => ({ id: 'p', name: 'p', goal: '', humanName: 'Paul', source: 'local' as const }),
    activityFor: () => undefined,
    speech: { isAvailable: () => false } as unknown as SpeechGateway,
    avatarsDir: dir,
    backgroundsDir: dir,
    version: 'test',
    devices,
  });
});

afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

const send = async (method: string, pathname: string, body?: unknown) => {
  const c = capture();
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const req = Object.assign(
    (async function* () { yield* chunks; })(),
    { url: pathname, method, headers: {} },
  ) as unknown as IncomingMessage;
  const handled = await router.handleRoutes(pathname, method, req, c.res);
  expect(handled).toBe(true);
  return c;
};

const call = async (pathname: string) => {
  const c = capture();
  const handled = await router.handleRoutes(pathname, 'GET', { url: pathname } as IncomingMessage, c.res);
  expect(handled).toBe(true);
  return c;
};

describe('GET /agents', () => {
  it('attaches the avatar framing the model file cannot carry', async () => {
    const { agents } = (await call(`${EMBODIMENT_BASE}/agents`)).body();
    const poppy = agents.find((a: { name: string }) => a.name === 'Poppy');
    expect(poppy.appearance).toEqual({ camera: [0, 1.7, 0.55], rotate: [0, 0, 0], fov: 44, scale: 1 });
  });

  it('still lists an agent whose avatar is not in the catalogue', async () => {
    const { agents } = (await call(`${EMBODIMENT_BASE}/agents`)).body();
    const amara = agents.find((a: { name: string }) => a.name === 'Amara');
    expect(amara.hasAvatar).toBe(true);
    expect(amara.appearance).toBeUndefined();
  });

  it('reports the template an instance was deployed from, where there is one', async () => {
    const { agents } = (await call(`${EMBODIMENT_BASE}/agents`)).body();
    expect(agents.find((a: { name: string }) => a.name === 'Poppy').templateId).toBe('tpl-poppy');
    expect(agents.find((a: { name: string }) => a.name === 'Blake').templateId).toBeUndefined();
  });
});

describe('GET /agents/{id}', () => {
  it('frames a single agent the same way the roster does', async () => {
    const one = (await call(`${EMBODIMENT_BASE}/agents/inst-Poppy`)).body();
    const { agents } = (await call(`${EMBODIMENT_BASE}/agents`)).body();
    expect(one).toEqual(agents.find((a: { id: string }) => a.id === 'inst-Poppy'));
  });

  it('resolves an agent by name as well as by instance id', async () => {
    expect((await call(`${EMBODIMENT_BASE}/agents/poppy`)).body().id).toBe('inst-Poppy');
  });
});

describe('device tools', () => {
  /** POST/PUT through the router the way a device would. */

  it('accepts a declaration and lists what is connected', async () => {
    await send('PUT', `${EMBODIMENT_BASE}/devices/phone`, {
      label: "Paul's phone",
      tools: [{ name: 'take_photo', description: 'Take a photo.' }],
    });
    const { devices: listed } = (await call(`${EMBODIMENT_BASE}/devices`)).body();
    expect(listed).toMatchObject([
      { deviceId: 'phone', label: "Paul's phone", tools: ['take_photo'] },
    ]);
  });

  it('refuses a declaration with no tool list', async () => {
    const c = await send('PUT', `${EMBODIMENT_BASE}/devices/phone`, { label: 'no tools' });
    expect(c.status()).toBe(400);
  });

  it('carries a call to the device and back', async () => {
    // The whole point: the agent calls a tool that runs somewhere else.
    await send('PUT', `${EMBODIMENT_BASE}/devices/phone`, {
      tools: [{ name: 'get_device_time', description: 'Local time on the device.' }],
    });

    const answer = devices.call('device__get_device_time');
    expect(delivered).toHaveLength(1);

    await send('POST', `${EMBODIMENT_BASE}/device-results/${delivered[0]!.id}`,
      { ok: true, result: 'half past three' });
    expect((await answer).text).toBe('half past three');
  });

  it('reports a result nobody was waiting for, rather than failing', async () => {
    // A device answering after a timeout raced and lost; that is not its fault.
    const c = await send('POST', `${EMBODIMENT_BASE}/device-results/made-up`, { ok: true, result: 'x' });
    expect(c.body()).toEqual({ settled: false });
  });

  it('stops offering the tools when a device unregisters', async () => {
    await send('PUT', `${EMBODIMENT_BASE}/devices/phone`, {
      tools: [{ name: 'take_photo', description: 'Take a photo.' }],
    });
    expect(devices.toolDefinitions()).toHaveLength(1);

    await send('DELETE', `${EMBODIMENT_BASE}/devices/phone`);
    expect(devices.toolDefinitions()).toEqual([]);
  });
});

// ── Capability exchange ──────────────────────────────────────────────────────
//
// Devices offering the same tools are not equivalent, and the runner has to
// know which it is talking to before deciding how to do a job.

describe('what a device says it can do', () => {
  const declare = (capabilities?: unknown) =>
    send('PUT', `${EMBODIMENT_BASE}/devices/phone`, {
      label: "Paul's phone",
      tools: [{ name: 'take_photo', description: 'Take a photo.' }],
      ...(capabilities === undefined ? {} : { capabilities }),
    });

  it('tells the device where faces will be embedded', async () => {
    // The reply is half a negotiation, not an acknowledgement: a phone that
    // can embed needs telling whether the runner wants it to.
    const res = await declare({ faceEmbedding: [{ model: 'mobilefacenet-v1', dimensions: 192 }] });

    expect(res.body().agreed.faceEmbedding).toBe('device');
    expect(res.body().agreed.faceModel).toEqual({ model: 'mobilefacenet-v1', dimensions: 192 });
  });

  it('keeps the work on the runner when the device cannot embed', async () => {
    expect((await declare({ camera: { lenses: ['front'] } })).body().agreed.faceEmbedding)
      .toBe('runner');
  });

  it('keeps it on the runner when the device offers a different model', async () => {
    // A vector from another model is not a worse answer, it is a meaningless
    // one — it would match nothing and nobody could tell why.
    expect((await declare({ faceEmbedding: [{ model: 'arcface', dimensions: 512 }] }))
      .body().agreed.faceEmbedding).toBe('runner');
  });

  it('accepts a device that declares nothing at all', async () => {
    // Every client written before this existed.
    const res = await declare(undefined);
    expect(res.status()).toBe(200);
    expect(res.body().agreed.faceEmbedding).toBe('runner');
  });

  it('accepts a client declaring something this runner has never heard of', async () => {
    const res = await declare({ teleportation: true, camera: { lenses: ['back'] } });
    expect(res.status()).toBe(200);
  });

  it('does not let rubbish into the store', async () => {
    await declare({ faceEmbedding: [{ model: '', dimensions: -4 }] });
    const { devices: listed } = (await call(`${EMBODIMENT_BASE}/devices`)).body();

    expect(listed[0].capabilities.faceEmbedding).toBeUndefined();
    expect(listed[0].agreed.faceEmbedding).toBe('runner');
  });

  it('reports what each device can do, for the operator', async () => {
    await declare({ camera: { lenses: ['front', 'back'] }, speech: { recognition: true } });
    const { devices: listed } = (await call(`${EMBODIMENT_BASE}/devices`)).body();

    expect(listed[0].capabilities.camera.lenses).toEqual(['front', 'back']);
    expect(listed[0].capabilities.speech.recognition).toBe(true);
  });

  it('replaces the declaration when a device re-registers', async () => {
    // An app upgraded mid-session should not keep its old abilities.
    await declare({ faceEmbedding: [{ model: 'mobilefacenet-v1', dimensions: 192 }] });
    const second = await declare({ camera: { lenses: ['front'] } });

    expect(second.body().agreed.faceEmbedding).toBe('runner');
  });
});
