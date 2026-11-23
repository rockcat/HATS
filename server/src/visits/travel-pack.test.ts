import { describe, expect, it } from 'vitest';
import type { AgentBundle } from '../agent-transfer/agent-bundle.js';
import { mergeMemory, openPack, outgoingPack, PackError, returningPack } from './travel-pack.js';

const bytes = (s: string) => new Uint8Array(Buffer.from(s, 'utf8'));
const text = (b: Uint8Array | undefined) => (b ? Buffer.from(b).toString('utf8') : undefined);

const bundle = (): AgentBundle => ({
  manifest: { format: 'hats-agent', version: 1, name: 'Ann', exportedAt: 't', includesCredentials: true, voices: [], warnings: [] } as AgentBundle['manifest'],
  definition: {
    id: 'id-ann', identity: { name: 'Ann', visualDescription: 'plain' }, hatType: [], model: 'm', providerName: 'anthropic',
    scheduledActionIds: ['a1'], personalMcpCredentials: { gmail: { token: 'secret' } },
  } as unknown as AgentBundle['definition'],
  threads: { general: [{ role: 'user', content: 'hello' }] } as unknown as AgentBundle['threads'],
  credentials: { gmail: { token: 'secret' } } as unknown as AgentBundle['credentials'],
  scheduledActions: [{ id: 'a1' }] as unknown as AgentBundle['scheduledActions'],
  files: new Map([['memory.json', bytes('{"type":"entity","name":"Ops"}\n')], ['calendar.json', bytes('[]')]]),
  assets: new Map([['avatars/max.glb', bytes('glb')]]),
});

describe('the pack going out', () => {
  it('carries settings and the agent\'s folder, but no logins, conversations, schedule or avatars', async () => {
    const out = await openPack(await outgoingPack(bundle()));
    expect(out.definition.id).toBe('id-ann');
    expect(out.definition).not.toHaveProperty('personalMcpCredentials');
    expect(out.definition.scheduledActionIds).toEqual([]);
    expect(out.credentials).toBeUndefined();
    expect(out.threads).toEqual({});
    expect(out.scheduledActions).toEqual([]);
    expect(out.assets.size).toBe(0);
    expect([...out.files.keys()].sort()).toEqual(['calendar.json', 'memory.json']);
  });
});

describe('the pack coming back', () => {
  it('carries only memory, and only when the host allows all of it', async () => {
    const back = await openPack((await returningPack(bundle(), 'all'))!);
    expect([...back.files.keys()]).toEqual(['memory.json']);
    expect(await returningPack(bundle(), 'summary')).toBeUndefined();
    expect(await returningPack(bundle(), 'none')).toBeUndefined();
  });
});

describe('openPack', () => {
  it('refuses anything that is not a travel pack', async () => {
    await expect(openPack({ zip: 'x' })).rejects.toThrow(PackError);
    await expect(openPack(null)).rejects.toThrow(PackError);
  });
});

describe('mergeMemory', () => {
  it('adds what was learned, each line once', () => {
    const home = bytes('{"type":"entity","name":"Ops"}\n{"type":"entity","name":"Ann"}\n');
    const visit = bytes('{"type":"entity","name":"Ann"}\n{"type":"entity","name":"Invoices"}\n');
    expect(text(mergeMemory(home, visit))!.trim().split('\n')).toEqual([
      '{"type":"entity","name":"Ops"}', '{"type":"entity","name":"Ann"}', '{"type":"entity","name":"Invoices"}',
    ]);
  });

  it('keeps home memory as it is when nothing came back, and takes the visit\'s when home had none', () => {
    const home = bytes('{"a":1}\n');
    expect(mergeMemory(home, undefined)).toBe(home);
    expect(text(mergeMemory(undefined, bytes('{"b":2}')))).toBe('{"b":2}\n');
  });
});

describe('the pack for a permanent move', () => {
  it('carries conversations and schedule, but never logins or avatars', async () => {
    const { movingPack } = await import('./travel-pack.js');
    const moved = await openPack(await movingPack(bundle()));
    expect(moved.threads).toEqual(bundle().threads);
    expect(moved.scheduledActions).toEqual(bundle().scheduledActions);
    expect(moved.definition.scheduledActionIds).toEqual(['a1']);
    expect(moved.definition).not.toHaveProperty('personalMcpCredentials');
    expect(moved.credentials).toBeUndefined();
    expect(moved.assets.size).toBe(0);
  });
});
