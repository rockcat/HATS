import { describe, it, expect } from 'vitest';
import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { LibraryAgentStore } from './library-agent-store.js';
import { seedBuiltIns, BUILTIN_CLAUDE_CODE_ID } from '../store/built-in-agents.js';
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

describe('saving one template twice at once', () => {
  it('never has two writes to one template in flight, and the last one wins', async () => {
    const { client, seen } = slowLibrary(poppy);
    const store = await storeFor(client);
    const def = store.get('poppy')!;

    await Promise.all([
      store.addOrUpdate({ ...def, scheduledActionIds: ['first'] }),
      store.addOrUpdate({ ...def, scheduledActionIds: ['second'] }),
    ]);
    expect(seen.maxOverlap).toBe(1);
    expect(seen.writes.at(-1)).toEqual(['second']);
  });
});

/** A library that hands out its own ids on create, as the real one does. */
function memoryLibrary() {
  const templates = new Map<string, AgentTemplate>();
  let next = 0;
  const save = (id: string, input: Partial<AgentTemplate>) => {
    const template = { ...poppy, ...input, id, revision: 1 } as AgentTemplate;
    templates.set(id, template);
    return template;
  };
  const client = {
    baseUrl: 'http://library',
    listTemplates: async () => [...templates.values()],
    createTemplate: async (input: Partial<AgentTemplate>) => save(`generated-${++next}`, input),
    putTemplate: async (id: string, input: Partial<AgentTemplate>) => save(id, input),
    updateTemplate: async (id: string, input: Partial<AgentTemplate>) => save(id, { ...templates.get(id), ...input }),
  } as unknown as AgentLibraryClient;
  return { client, templates };
}

describe('the built-in Claude Code agent', () => {
  it('is added once, however often the runner starts', async () => {
    const { client, templates } = memoryLibrary();
    for (let start = 0; start < 3; start++) await seedBuiltIns(await storeFor(client));

    expect([...templates.values()].filter((t) => t.name === 'Claude Code')).toHaveLength(1);
    expect(templates.has(BUILTIN_CLAUDE_CODE_ID)).toBe(true);
  });

  it('keeps the command that runs it', async () => {
    const { client } = memoryLibrary();
    await seedBuiltIns(await storeFor(client));

    const again = await storeFor(client);
    expect(again.get(BUILTIN_CLAUDE_CODE_ID)?.externalEndpoint).toMatchObject({ mode: 'subprocess', command: 'claude' });
  });

  it('still lets the library choose the id of an agent that brings none', async () => {
    const { client } = memoryLibrary();
    const store = await storeFor(client);
    const saved = await store.addOrUpdate({ identity: { name: 'New', visualDescription: 'x' }, hatType: [], model: 'm', providerName: 'anthropic', scheduledActionIds: [] });
    expect(saved.id).toMatch(/^generated-/);
  });
});
