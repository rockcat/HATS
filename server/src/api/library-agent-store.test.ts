import { describe, it, expect } from 'vitest';
import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { LibraryAgentStore } from './library-agent-store.js';
import type { AgentLibraryClient } from '../../../packages/clients/src/agent-library-client.js';
import type { AgentTemplate } from '../../../packages/contracts/src/types.js';

/**
 * A library that answers slowly and notes every write, so overlapping writes
 * to one template — the cause of "ENOENT … .json.tmp" — can be seen.
 */
function slowLibrary(initial: AgentTemplate) {
  let template = initial;
  let inFlight = 0;
  const seen = { maxOverlap: 0, writes: [] as (string[] | undefined)[] };
  const client = {
    baseUrl: 'http://library',
    listTemplates: async () => [template],
    updateTemplate: async (_id: string, patch: Partial<AgentTemplate>) => {
      inFlight++;
      seen.maxOverlap = Math.max(seen.maxOverlap, inFlight);
      seen.writes.push(patch.scheduledActionIds);
      await new Promise((r) => setTimeout(r, 20));
      template = { ...template, ...patch, revision: template.revision + 1 };
      inFlight--;
      return template;
    },
  } as unknown as AgentLibraryClient;
  return { client, seen };
}

const poppy: AgentTemplate = {
  schemaVersion: 1 as AgentTemplate['schemaVersion'], id: 'poppy', name: 'Poppy', hats: ['blue'],
  identity: { visualDescription: 'a person' }, model: { provider: 'anthropic', model: 'claude-haiku-4-5' },
  scheduledActionIds: ['old'], revision: 1, createdAt: '', updatedAt: '',
};

async function storeFor(client: AgentLibraryClient) {
  const dir = await mkdtemp(path.join(tmpdir(), 'lib-'));
  const store = new LibraryAgentStore(client, path.join(dir, 'secrets.json'));
  await store.load();
  return store;
}

describe('saving an agent while a state save is running', () => {
  it('never has two writes to one template in flight', async () => {
    const { client, seen } = slowLibrary(poppy);
    const store = await storeFor(client);
    const def = store.get('poppy')!;

    // The background state save and the editor's save, at the same moment.
    await Promise.all([
      store.syncRunningAgent(def),
      store.addOrUpdate({ ...def, scheduledActionIds: ['new'] }),
    ]);
    expect(seen.maxOverlap).toBe(1);
  });

  it('does not write the old assignments back over a newer save', async () => {
    const { client, seen } = slowLibrary(poppy);
    const store = await storeFor(client);
    const running = store.get('poppy')!;

    await store.syncRunningAgent(running);                                   // agent is running
    await store.addOrUpdate({ ...running, scheduledActionIds: ['new'] });   // ticked in the editor
    await store.syncRunningAgent({ ...running, scheduledActionIds: ['old'] }); // next autosave, stale copy

    expect(seen.writes.at(-1)).toEqual(['new']);
    expect(store.get('poppy')!.scheduledActionIds).toEqual(['new']);
  });
});
