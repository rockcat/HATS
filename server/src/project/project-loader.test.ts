// Switching projects used to build every project from the definition the
// runner started with, so one project's agent turned up in the next and
// multiplied on each switch back. These replay that.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { makeProjectLoader, deployedSince, type ProjectSource } from './project-loader.js';
import { AgentStore } from '../api/agent-store.js';
import { MockProvider } from '../providers/mock.js';
import { closeAllProjectDbs } from '../store/project-db.js';
import type { DeployedAgent, ProjectDefinition } from '../../../packages/contracts/src/types.js';
import type { TeamOrchestrator } from '../orchestrator/orchestrator.js';

let root = '';

beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'hats-loader-')); });
afterEach(async () => {
  closeAllProjectDbs();
  await rm(root, { recursive: true, force: true });
});

const deployed = (instanceId: string, name: string, enabled = true): DeployedAgent => ({
  schemaVersion: 1 as DeployedAgent['schemaVersion'], instanceId, name, enabled,
  hats: ['blue'], identity: { visualDescription: 'An assistant.' },
  model: { provider: 'anthropic', model: 'mock-model' }, deployedAt: '2026-01-01',
});
const poppy = deployed('poppy-1', 'Poppy');

const definition = (id: string, team: DeployedAgent[]): ProjectDefinition =>
  ({ id, name: id, team, humanName: 'Boss', goal: '', revision: 1 }) as unknown as ProjectDefinition;

async function harness(definitions: Record<string, ProjectDefinition | null>) {
  const store = new AgentStore(path.join(root, 'agents.json'));
  await store.load();
  const opened: string[] = [];
  const load = makeProjectLoader({
    agentStore: store,
    providerFactory: () => new MockProvider({ content: 'ok' }),
    defaultModel: 'mock-model',
    sourceFor: async (id): Promise<ProjectSource> => {
      opened.push(id);
      return { definition: definitions[id] ?? null, client: null };
    },
  });
  const open = (id: string) => {
    const dir = path.join(root, id);
    return load(dir, path.join(dir, 'kanban-board.json'), path.join(dir, 'team-state.json'));
  };
  // What a switch does to the project being left: save its state, stop it.
  const close = (o: TeamOrchestrator, id: string) => o.shutdown(path.join(root, id, 'team-state.json'));
  return { open, close, opened };
}

const names = (o: TeamOrchestrator) => o.listAgents().map(a => a.name).sort();

describe('switching between projects', () => {
  it('reads the definition of the project being opened, every time', async () => {
    const h = await harness({ a: definition('a', [poppy]), b: definition('b', []) });
    const a = await h.open('a');
    await h.close(a, 'a');
    const b = await h.open('b');
    await h.close(b, 'b');
    expect(h.opened).toEqual(['a', 'b']);
  });

  it('keeps one project\'s agent out of another, and never doubles it', async () => {
    const h = await harness({ a: definition('a', [poppy]), b: definition('b', []) });

    for (let visit = 0; visit < 3; visit++) {
      const a = await h.open('a');
      expect(names(a).filter(n => n === 'Poppy')).toHaveLength(1);
      await h.close(a, 'a');

      const b = await h.open('b');
      expect(names(b)).not.toContain('Poppy');
      await h.close(b, 'b');
    }
  });
});

describe('agents deployed since the last run', () => {
  const running = [{ id: 'poppy-1', name: 'Poppy' }];

  it('are the ones the team does not have yet', () => {
    const rhoda = deployed('rhoda-1', 'Rhoda');
    expect(deployedSince(definition('a', [poppy, rhoda]), running)).toEqual([rhoda]);
  });

  it('do not include an agent already running under another id', () => {
    const again = deployed('poppy-2', 'poppy');
    expect(deployedSince(definition('a', [again]), running)).toEqual([]);
  });

  it('do not include a disabled one', () => {
    const off = deployed('x', 'Off', false);
    expect(deployedSince(definition('a', [off]), running)).toEqual([]);
  });
});
