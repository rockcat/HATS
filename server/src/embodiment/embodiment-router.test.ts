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

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'hats-router-'));
  await writeFile(path.join(dir, 'avatars.json'), JSON.stringify({
    avatars: [{ name: 'Max', file: 'max.glb', camera: [0, 1.7, 0.55], rotate: [0, 0, 0], fov: 44, scale: 1 }],
  }));

  const agents = [agent('Poppy', 'max.glb', 'tpl-poppy'), agent('Amara', 'dave.glb'), agent('Blake', undefined)];
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
  });
});

afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

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
