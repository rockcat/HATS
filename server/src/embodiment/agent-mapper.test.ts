import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { toEmbodiedAgent } from './agent-mapper.js';
import { findAvatarByFile, framingOf } from '../render/avatar-catalogue.js';
import type { IAgent } from '../agent/iagent.js';

/** Only the fields the mapper reads; the rest of IAgent is irrelevant here. */
const fakeAgent = (identity: Record<string, unknown>): IAgent => ({
  id: 'inst-1',
  name: 'Poppy',
  hatType: ['white'],
  state: 'idle',
  config: {
    identity: { name: 'Poppy', ...identity },
    provider: { name: 'anthropic' },
    model: 'claude-haiku-4-5-20251001',
  },
  getThreadSummary: () => ({ general: 3 }),
  getHourlyCost: () => 0.42,
  isCostIdled: () => false,
} as unknown as IAgent);

let dir = '';

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'hats-embodiment-'));
  await writeFile(path.join(dir, 'avatars.json'), JSON.stringify({
    avatars: [{ name: 'Max', file: 'max.glb', camera: [0, 1.7, 0.55], rotate: [0, 12, 0], fov: 44, scale: 1 }],
  }));
});

afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

describe('toEmbodiedAgent', () => {
  it('reports what the agent has, so a client knows what it can render', () => {
    const embodied = toEmbodiedAgent(fakeAgent({ avatar: 'max.glb', voice: 'en_GB-semaine-medium' }), undefined);
    expect(embodied).toMatchObject({
      id: 'inst-1', name: 'Poppy', hasAvatar: true, hasVoice: true, hourlyCost: 0.42,
    });
  });

  it('hands over the avatar framing, which the model file does not carry', async () => {
    const framing = framingOf(await findAvatarByFile(dir, 'max.glb'));
    const embodied = toEmbodiedAgent(fakeAgent({ avatar: 'max.glb' }), undefined, framing);
    // Without this a client can download the model and still have no idea
    // where to put the camera.
    expect(embodied.appearance).toEqual({ camera: [0, 1.7, 0.55], rotate: [0, 12, 0], fov: 44, scale: 1 });
  });

  it('omits appearance for an avatar the runner cannot frame', async () => {
    const framing = framingOf(await findAvatarByFile(dir, 'dave.glb'));
    const embodied = toEmbodiedAgent(fakeAgent({ avatar: 'dave.glb' }), undefined, framing);
    expect(embodied.hasAvatar).toBe(true);
    expect('appearance' in embodied).toBe(false);
  });

  it('omits appearance entirely for an agent with no avatar', () => {
    const embodied = toEmbodiedAgent(fakeAgent({}), undefined);
    expect(embodied.hasAvatar).toBe(false);
    expect('appearance' in embodied).toBe(false);
  });
});
