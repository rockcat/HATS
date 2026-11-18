// Deleting or renaming an agent takes its scheduled tasks with it, and a
// loaded team drops tasks left behind by agents deleted before that was so.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { TeamOrchestrator } from './orchestrator.js';
import { MockProvider } from '../providers/mock.js';
import { HatType } from '../../../packages/core/src/hats/types.js';
import { closeAllProjectDbs } from '../store/project-db.js';

let dir = '';
let orch: TeamOrchestrator;
const provider = new MockProvider({ content: 'ok' });

const register = (name: string) => orch.registerAgent({
  id: `id-${name}`, identity: { name, visualDescription: 'An assistant.' },
  hatType: [HatType.Blue], provider, model: 'mock-model',
});

const agendaNames = () => orch.getAgendaStore()!.list().map(e => e.agentName).sort();
const schedule = (agentName: string) =>
  orch.getAgendaStore()!.add({ agentName, label: 'Check mail', description: '', intervalSeconds: 600 });

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'hats-agenda-follows-'));
  orch = new TeamOrchestrator({ storePath: path.join(dir, 'events.jsonl'), projectsRoot: dir });
  await orch.init();
  await orch.initAgendaStore(path.join(dir, 'agent-agenda.json'));
  orch.stopAgendaRunner();
  register('Poppy');
  register('Rhoda');
  await schedule('Poppy');
  await schedule('Rhoda');
});

afterEach(async () => {
  orch.stopAgendaRunner();
  closeAllProjectDbs();
  await rm(dir, { recursive: true, force: true });
});

describe('an agent\'s scheduled tasks', () => {
  it('go when the agent is deleted', async () => {
    await orch.removeAgent('Poppy');
    expect(agendaNames()).toEqual(['Rhoda']);
  });

  it('follow the agent when it is renamed', async () => {
    await orch.renameAgent('Poppy', 'Penny');
    expect(agendaNames()).toEqual(['Penny', 'Rhoda']);
  });

  it('are dropped on load when their agent is no longer on the team', async () => {
    await schedule('Poppy 2');
    expect(await orch.pruneAgenda()).toBe(1);
    expect(agendaNames()).toEqual(['Poppy', 'Rhoda']);
  });

  it('are all kept when no team loaded', async () => {
    await orch.removeAgent('Poppy');
    await orch.removeAgent('Rhoda');
    await schedule('Poppy');
    expect(await orch.pruneAgenda()).toBe(0);
    expect(agendaNames()).toEqual(['Poppy']);
  });
});
