// Names identify agents, so the same name arriving twice is one agent, not
// two. Teams saved while project switching leaked agents hold several copies;
// restoring one must keep the first and drop the rest.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { TeamOrchestrator } from './orchestrator.js';
import { AgentStore } from '../api/agent-store.js';
import { MockProvider } from '../providers/mock.js';
import { HatType } from '../../../packages/core/src/hats/types.js';
import { closeAllProjectDbs } from '../store/project-db.js';

let dir = '';
let orch: TeamOrchestrator;
const provider = new MockProvider({ content: 'ok' });

const poppy = (id: string) => ({
  id, identity: { name: 'Poppy', visualDescription: 'An assistant.' },
  hatType: [HatType.Blue], provider, model: 'mock-model',
});

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'hats-register-'));
  orch = new TeamOrchestrator({ storePath: path.join(dir, 'events.jsonl'), projectsRoot: dir });
  await orch.init();
});

afterEach(async () => {
  closeAllProjectDbs();
  await rm(dir, { recursive: true, force: true });
});

describe('the same agent arriving twice', () => {
  it('is not added a second time', () => {
    const first = orch.registerAgent(poppy('poppy-1'));
    const second = orch.registerAgent(poppy('poppy-2'));
    expect(second).toBe(first);
    expect(orch.listAgents()).toHaveLength(1);
  });

  it('is dropped from a saved team, keeping the first copy and its history', async () => {
    const store = new AgentStore(path.join(dir, 'agents.json'));
    await store.load();
    for (const id of ['poppy-1', 'poppy-2', 'poppy-3']) {
      await store.addOrUpdate({ id, identity: { name: 'Poppy', visualDescription: 'x' }, hatType: [HatType.Blue],
        model: 'mock-model', providerName: 'anthropic', scheduledActionIds: [] });
    }
    orch.setAgentStore(store);
    const state = path.join(dir, 'team-state.json');
    const said = (text: string) => [{ role: 'user', content: text, timestamp: '2026-01-01T00:00:00Z' }];
    await writeFile(state, JSON.stringify({
      version: 2, savedAt: '2026-01-01', humanName: 'Boss',
      agentIds: ['poppy-1', 'poppy-2', 'poppy-3'],
      agentHistories: { 'poppy-1': said('first'), 'poppy-2': said('second'), 'poppy-3': said('third') },
      tasks: [], meetings: [], mcpServers: [],
    }));

    await orch.loadState(state, () => provider);

    expect(orch.listAgents().map(a => a.id)).toEqual(['poppy-1']);
    expect(orch.listAgents()[0]!.getHistory()[0]?.content).toBe('first');
  });
});

describe('an agent\'s limits', () => {
  it('survive a save and a restore', async () => {
    const store = new AgentStore(path.join(dir, 'agents.json'));
    await store.load();
    orch.setAgentStore(store);
    orch.registerAgent({ ...poppy('poppy-1'), maxCostPerHour: 0.5, maxContextTokens: 8000 });
    const state = path.join(dir, 'team-state.json');
    await orch.saveState(state);

    expect(store.get('poppy-1')).toMatchObject({ maxCostPerHour: 0.5, maxContextTokens: 8000 });

    const again = new TeamOrchestrator({ storePath: path.join(dir, 'events2.jsonl'), projectsRoot: dir });
    await again.init();
    again.setAgentStore(store);
    await again.loadState(state, () => provider);
    expect(again.getAgent('Poppy')?.config).toMatchObject({ maxCostPerHour: 0.5, maxContextTokens: 8000 });
  });
});
