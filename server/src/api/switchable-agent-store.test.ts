import { describe, it, expect } from 'vitest';
import { SwitchableAgentStore, type ConnectedAgentStore } from './switchable-agent-store.js';
import type { AgentDefinitionStore } from './agent-store.js';
import type { AgentDefinition } from '../store/team-snapshot.js';

const def = (id: string): AgentDefinition =>
  ({ id, identity: { name: id }, hatType: [], model: 'm', providerName: 'p', scheduledActionIds: [] }) as unknown as AgentDefinition;

/** A store holding fixed entries; `withSecrets` adds the credential methods. */
function fakeStore(ids: string[], withSecrets = false): AgentDefinitionStore {
  const items = new Map(ids.map((id) => [id, def(id)]));
  const store: AgentDefinitionStore = {
    load: async () => {},
    list: () => [...items.values()],
    get: (id) => items.get(id),
    has: (id) => items.has(id),
    addOrUpdate: async (d) => { items.set(d.id!, d); return d; },
    remove: async (id) => items.delete(id),
  };
  if (withSecrets) {
    store.secretsFor = () => ({ teamContext: 'kept' });
    store.setSecrets = async () => {};
  }
  return store;
}

describe('SwitchableAgentStore', () => {
  it('is empty until loaded', () => {
    const store = new SwitchableAgentStore(async () => ({ store: fakeStore(['a']), source: { kind: 'local' } }));
    expect(store.list()).toEqual([]);
    expect(store.has('a')).toBe(false);
  });

  it('moves to the library when a later load finds it', async () => {
    const answers: ConnectedAgentStore[] = [
      { store: fakeStore(['builtin']), source: { kind: 'local' } },
      { store: fakeStore(['builtin', 'poppy', 'rhoda'], true), source: { kind: 'library', url: 'http://lib' } },
    ];
    const store = new SwitchableAgentStore(async () => answers.shift()!);

    await store.load();
    expect(store.source).toEqual({ kind: 'local' });
    expect(store.list().map((d) => d.id)).toEqual(['builtin']);

    await store.load();
    expect(store.source).toEqual({ kind: 'library', url: 'http://lib' });
    expect(store.list()).toHaveLength(3);
    expect(store.get('poppy')?.id).toBe('poppy');
  });

  it('has credential methods only when the store behind has them', async () => {
    const answers: ConnectedAgentStore[] = [
      { store: fakeStore([]), source: { kind: 'local' } },
      { store: fakeStore([], true), source: { kind: 'library', url: 'http://lib' } },
    ];
    const store = new SwitchableAgentStore(async () => answers.shift()!);

    await store.load();
    expect(store.secretsFor).toBeUndefined();
    expect(store.setSecrets).toBeUndefined();

    await store.load();
    expect(store.secretsFor?.('x')).toEqual({ teamContext: 'kept' });
    expect(store.setSecrets).toBeTypeOf('function');
  });

  it('shares one load between overlapping refreshes', async () => {
    let calls = 0;
    const store = new SwitchableAgentStore(async () => { calls++; return { store: fakeStore([]), source: { kind: 'local' } }; });
    await Promise.all([store.load(), store.load()]);
    expect(calls).toBe(1);
  });
});
