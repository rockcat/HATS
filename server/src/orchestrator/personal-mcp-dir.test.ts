// Personal MCP servers that keep per-agent files (memory, calendar) are given
// the agent's folder when they start. They used to start before the agent was
// in the team, so the folder could not be found, and the memory server wrote a
// bare "memory.json" into the npx cache — lost with the container.

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

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'hats-personal-dir-'));
  orch = new TeamOrchestrator({
    storePath: path.join(dir, 'events.jsonl'),
    projectsRoot: path.join(dir, 'projects'),
  });
  await orch.init();
  orch.setProjectDir(dir);
});

afterEach(async () => {
  closeAllProjectDbs();
  await rm(dir, { recursive: true, force: true });
});

describe('starting an agent\'s personal servers', () => {
  it('can already find the agent\'s own folder', () => {
    const seen: (string | undefined)[] = [];
    // Stand in for the real start, which would spawn the server: record what
    // folder it would be given at the moment it is called.
    (orch as unknown as { startPersonalMcp: (name: string) => Promise<void> }).startPersonalMcp =
      async (name: string) => { seen.push(orch.agentDir(name)); };

    const agent = orch.registerAgent({
      id: 'poppy-id',
      identity: { name: 'Poppy', visualDescription: 'An assistant.' },
      hatType: [HatType.Blue],
      provider: new MockProvider({ content: 'ok' }),
      model: 'mock-model',
      personalMcpCredentials: { memory: {} },
    });

    expect(seen).toEqual([path.join(dir, 'agents', agent.id)]);
  });
});
