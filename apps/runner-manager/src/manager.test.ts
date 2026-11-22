import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, stat } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { Registry } from './registry.js';
import { RunnerManager, LaunchError } from './manager.js';
import type { ManagedContainer } from './types.js';

/** A Docker that records what it is asked to do. */
function fakeDocker(containers: ManagedContainer[] = []) {
  const created: Array<{ name: string; spec: Record<string, unknown> }> = [];
  const removed: string[] = [];
  return {
    created, removed,
    self: async () => ({ hostData: '/host/hats/data', network: 'hats_default' }),
    runners: async () => containers,
    create: async (name: string, spec: Record<string, unknown>) => { created.push({ name, spec }); return `id-${name}`; },
    start: async () => {},
    stop: async () => {},
    remove: async (id: string) => { removed.push(id); },
  };
}

let dataDir: string;
beforeEach(async () => { dataDir = await mkdtemp(path.join(tmpdir(), 'runner-manager-')); });
afterEach(async () => { await rm(dataDir, { recursive: true, force: true }); });

function managerWith(docker: ReturnType<typeof fakeDocker>, registry = new Registry(), envFile: string | null = null) {
  return new RunnerManager({
    docker, registry, selfId: 'self', dataDir, image: 'hats-runner:test',
    ports: { from: 3101, to: 3103 }, envFile,
    overrides: { AGENT_LIBRARY_URL: 'http://agent-library:3010' },
    listProjects: async () => [{ id: 'paige', name: 'Paige' }, { id: 'rhoda', name: 'Rhoda' }],
  });
}

describe('launching a runner', () => {
  it('starts one container on the first free port, with its folders made', async () => {
    const docker = fakeDocker([{ id: 'c', project: 'paige', port: 3101, running: true }]);
    const envFile = path.join(dataDir, '.env');
    await writeFile(envFile, 'ANTHROPIC_API_KEY=k\n');

    const runner = await managerWith(docker, new Registry(), envFile).launch('rhoda');

    expect(runner).toMatchObject({ project: 'rhoda', port: 3102, status: 'starting', managed: true });
    expect(docker.created).toHaveLength(1);
    expect(docker.created[0]?.name).toBe('hats-runner-rhoda');
    expect((docker.created[0]?.spec as { Env: string[] }).Env).toContain('ANTHROPIC_API_KEY=k');
    for (const dir of ['runners/rhoda', 'projects/rhoda', 'avatars']) {
      expect((await stat(path.join(dataDir, dir))).isDirectory(), dir).toBe(true);
    }
  });

  it('refuses a second runner for one project, which would overwrite its state', async () => {
    const registry = new Registry();
    registry.heartbeat({ project: 'Paige', port: 3001 });
    await expect(managerWith(fakeDocker(), registry).launch('paige'))
      .rejects.toMatchObject({ status: 409 });
  });

  it('says so when every port is taken', async () => {
    const docker = fakeDocker([3101, 3102, 3103].map((port) => ({ id: `c${port}`, project: `p${port}`, port, running: true })));
    await expect(managerWith(docker).launch('rhoda')).rejects.toMatchObject({ status: 503 });
  });

  it('will not use a project name as a path outside the data folder', async () => {
    await expect(managerWith(fakeDocker()).launch('../etc')).rejects.toBeInstanceOf(LaunchError);
  });
});

describe('the project list', () => {
  it('shows every project with its runner, and runners for projects it does not know', async () => {
    const registry = new Registry();
    registry.heartbeat({ project: 'paige', port: 3001 });
    registry.heartbeat({ project: 'scratch', port: 3005 });
    const rows = await managerWith(fakeDocker(), registry).overview();
    expect(rows.map((r) => [r.id, r.runner?.port ?? null])).toEqual([['paige', 3001], ['rhoda', null], ['scratch', 3005]]);
  });
});

describe('removing a runner', () => {
  it('removes only a container it started', async () => {
    const docker = fakeDocker([{ id: 'c1', project: 'paige', port: 3101, running: true }]);
    await managerWith(docker).remove('Paige');
    expect(docker.removed).toEqual(['c1']);
    await expect(managerWith(docker).remove('evan')).rejects.toMatchObject({ status: 404 });
  });
});
