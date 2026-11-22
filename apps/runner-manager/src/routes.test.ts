import { describe, it, expect, afterEach } from 'vitest';
import type { IncomingMessage } from 'http';
import type { AddressInfo } from 'net';
import { startService, type RunningService } from '@hats/service-kit/index';
import type { Authenticator } from '@hats/auth/authenticator';
import { Registry } from './registry.js';
import { RunnerManager, LaunchError } from './manager.js';
import { runnerRoutes } from './routes.js';

/** Signs in whoever sends "Bearer <role>". */
const auth: Authenticator = {
  authenticate: async (req: IncomingMessage) => {
    const role = req.headers['authorization']?.replace('Bearer ', '');
    return role === 'admin' || role === 'user' ? { userId: role, username: role, role, expiresAt: Infinity } : null;
  },
};

let running: RunningService | null = null;
afterEach(async () => { await running?.stop(); running = null; });

async function serve(launch: (project: string) => Promise<unknown> = async (project) => ({ project, port: 3101, status: 'starting', managed: true })) {
  const registry = new Registry();
  const manager = {
    overview: async () => registry.list([]).map((r) => ({ id: r.project, name: r.project, runner: r })),
    launch,
    remove: async () => {},
  } as unknown as RunnerManager;
  running = await startService({ name: 'test', port: 0, routes: runnerRoutes({ manager, registry, auth, canLaunch: () => true }) });
  // running.port is the port asked for, 0 here; the server knows the one it got.
  return `http://127.0.0.1:${(running.server.address() as AddressInfo).port}/api/v1/runners`;
}

const as = (role: string, init: RequestInit = {}) =>
  ({ ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${role}`, ...(init.headers ?? {}) } });

describe('the runner manager API', () => {
  it('takes a heartbeat without sign-in, and lists it to a signed-in user', async () => {
    const base = await serve();
    expect((await fetch(`${base}/heartbeat`, { method: 'POST', body: JSON.stringify({ project: 'paige', port: 3002 }) })).status).toBe(204);

    const list = await (await fetch(base, as('user'))).json() as { projects: Array<{ id: string; runner: { port: number } }>; canLaunch: boolean };
    expect(list.projects.map((p) => [p.id, p.runner.port])).toEqual([['paige', 3002]]);
    expect(list.canLaunch).toBe(false);
    expect((await (await fetch(base, as('admin'))).json() as { canLaunch: boolean }).canLaunch).toBe(true);
  });

  it('lists nothing to someone not signed in', async () => {
    expect((await fetch(await serve())).status).toBe(401);
  });

  it('lets only an admin launch', async () => {
    const base = await serve();
    const body = JSON.stringify({ project: 'rhoda' });
    expect((await fetch(base, as('user', { method: 'POST', body }))).status).toBe(403);
    const made = await fetch(base, as('admin', { method: 'POST', body }));
    expect(made.status).toBe(201);
    expect(await made.json()).toMatchObject({ project: 'rhoda', status: 'starting' });
  });

  it('passes on why a launch was refused', async () => {
    const base = await serve(async () => { throw new LaunchError(409, 'rhoda already has a runner, on port 3101.'); });
    const res = await fetch(base, as('admin', { method: 'POST', body: JSON.stringify({ project: 'rhoda' }) }));
    expect(res.status).toBe(409);
    expect(JSON.stringify(await res.json())).toContain('already has a runner');
  });

  it('refuses a heartbeat that does not say which project and port', async () => {
    const base = await serve();
    expect((await fetch(`${base}/heartbeat`, { method: 'POST', body: JSON.stringify({ project: 'x' }) })).status).toBe(400);
  });
});
