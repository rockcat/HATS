import { describe, expect, it, vi } from 'vitest';
import { createDeployedAgent } from '../../../packages/contracts/src/factories.js';
import type { DeployedAgent, ProjectChange, ProjectDefinition } from '../../../packages/contracts/src/types.js';
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

type Listener = (change: ProjectChange) => void;

/** A Project Server holding `stored`, whose change stream the test drives. */
function fakeClient(stored: ProjectDefinition) {
  const stream: { send?: Listener; connect?: (up: boolean) => void; stopped: boolean } = { stopped: false };
  return {
    stream,
    getProject: vi.fn(async () => stored),
    replaceProject: vi.fn(async (_id: string, fields: Partial<ProjectDefinition>) =>
      ({ ...stored, ...fields, revision: stored.revision + 1 }) as ProjectDefinition),
    watchProject: vi.fn((_id: string, onChange: Listener, o: { onState?: (up: boolean) => void }) => {
      stream.send = onChange;
      stream.connect = (up) => o.onState?.(up);
      return { stop: () => { stream.stopped = true; } };
    }),
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

  it('keeps looking while the change stream is down, until stopped', async () => {
    vi.useFakeTimers();
    try {
      const client = fakeClient(definition(2));
      const { sync } = syncWith(client, definition(2));
      sync.start(1_000, 60_000);
      await vi.advanceTimersByTimeAsync(3_000);
      expect(client.getProject).toHaveBeenCalledTimes(3);
      sync.stop();
      expect(client.stream.stopped).toBe(true);
      await vi.advanceTimersByTimeAsync(3_000);
      expect(client.getProject).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies a change the moment the stream announces it', async () => {
    const newer = definition(3, [member('Ann'), member('Bo')]);
    const client = fakeClient(newer);
    const { sync, apply } = syncWith(client, definition(2));
    sync.start(60_000, 60_000);

    client.stream.send!({ type: 'project_changed', id: 'p', revision: 3 });
    await sync.pull(); // waits behind the pull the notice queued

    expect(apply).toHaveBeenCalledWith(newer, expect.anything());
    sync.stop();
  });

  it('ignores a notice of the revision it already has', async () => {
    const client = fakeClient(definition(2));
    const { sync } = syncWith(client, definition(2));
    sync.start(60_000, 60_000);
    client.stream.send!({ type: 'project_changed', id: 'p', revision: 2 });
    expect(client.getProject).not.toHaveBeenCalled();
    sync.stop();
  });

  it('looks once on connecting, then only every slow interval while connected', async () => {
    vi.useFakeTimers();
    try {
      const client = fakeClient(definition(2));
      const { sync } = syncWith(client, definition(2));
      sync.start(1_000, 10_000);
      client.stream.connect!(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(client.getProject).toHaveBeenCalledTimes(1);   // catching up on connecting
      await vi.advanceTimersByTimeAsync(9_000);
      expect(client.getProject).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(client.getProject).toHaveBeenCalledTimes(2);

      client.stream.connect!(false);                         // dropped: back to every second
      await vi.advanceTimersByTimeAsync(3_000);
      expect(client.getProject).toHaveBeenCalledTimes(5);
      sync.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
