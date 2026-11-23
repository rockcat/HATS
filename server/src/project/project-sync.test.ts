import { describe, expect, it, vi } from 'vitest';
import { createDeployedAgent } from '../../../packages/contracts/src/factories.js';
import type { DeployedAgent, ProjectDefinition } from '../../../packages/contracts/src/types.js';
import type { ProjectServerClient } from '../../../packages/clients/src/project-server-client.js';
import type { TeamOrchestrator } from '../orchestrator/orchestrator.js';
import { ProjectSync } from './project-sync.js';

const member = (name: string, extra: Partial<DeployedAgent> = {}): DeployedAgent =>
  createDeployedAgent({ instanceId: `id-${name.toLowerCase()}`, name, hats: ['white'], ...extra });

const definition = (revision: number, team: DeployedAgent[] = [member('Ann')]): ProjectDefinition =>
  ({ id: 'p', name: 'P', humanName: 'Boss', team, revision, goal: '' }) as ProjectDefinition;

/** A team with no agents running: enough for the sync, which only reads it. */
const emptyTeam = {
  listAgents: () => [],
  getProjectGoal: () => '',
  getHumanName: () => 'Boss',
} as unknown as TeamOrchestrator;

function fakeClient(stored: ProjectDefinition) {
  return {
    getProject: vi.fn(async () => stored),
    replaceProject: vi.fn(async (_id: string, fields: Partial<ProjectDefinition>) =>
      ({ ...stored, ...fields, revision: stored.revision + 1 }) as ProjectDefinition),
  };
}

const syncWith = (client: ReturnType<typeof fakeClient>, held: ProjectDefinition, apply = vi.fn(async () => {})) =>
  ({ sync: new ProjectSync(client as unknown as ProjectServerClient, held, () => emptyTeam, apply), apply });

describe('ProjectSync', () => {
  it('applies a newer revision saved in the Designer', async () => {
    const newer = definition(3, [member('Ann'), member('Bo')]);
    const client = fakeClient(newer);
    const held = definition(2);
    const { sync, apply } = syncWith(client, held);

    await sync.pull();

    expect(apply).toHaveBeenCalledWith(newer, held.team);
    expect(sync.current.revision).toBe(3);
  });

  it('leaves the team alone when nothing new was saved', async () => {
    const client = fakeClient(definition(2));
    const { sync, apply } = syncWith(client, definition(2));
    await sync.pull();
    expect(apply).not.toHaveBeenCalled();
  });

  it('on a conflict, applies the Designer\'s edit before writing on top of it', async () => {
    const newer = definition(5, [member('Ann'), member('Bo')]);
    const client = fakeClient(newer);
    const conflict = Object.assign(new Error('conflict'), { status: 409 });
    client.replaceProject.mockRejectedValueOnce(conflict);
    const { sync, apply } = syncWith(client, definition(2));

    await sync.flush();

    expect(apply).toHaveBeenCalledWith(newer, expect.anything());
    expect(apply.mock.invocationCallOrder[0]).toBeLessThan(client.replaceProject.mock.invocationCallOrder[1]!);
    expect(client.replaceProject).toHaveBeenLastCalledWith('p', expect.anything(), 5);
  });

  it('keeps members disabled in the Designer when it writes', async () => {
    const off = member('Cy', { enabled: false });
    const client = fakeClient(definition(2, [off]));
    const { sync } = syncWith(client, definition(2, [off]));

    await sync.flush();

    const written = client.replaceProject.mock.calls[0]![1] as { team: DeployedAgent[] };
    expect(written.team).toEqual([off]);
  });

  it('keeps looking until stopped', async () => {
    vi.useFakeTimers();
    try {
      const client = fakeClient(definition(2));
      const { sync } = syncWith(client, definition(2));
      sync.start(1_000);
      await vi.advanceTimersByTimeAsync(3_000);
      expect(client.getProject).toHaveBeenCalledTimes(3);
      sync.stop();
      await vi.advanceTimersByTimeAsync(3_000);
      expect(client.getProject).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
