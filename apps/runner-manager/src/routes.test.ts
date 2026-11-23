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

describe('finding a team to visit', () => {
  const card = (team: string, visits: { visitTo: string[]; hostFrom: string[] }, extra: Record<string, unknown> = {}) => ({
    team, name: team, summary: '', tags: [], members: [], tools: [], models: [],
    hosting: visits.hostFrom.length > 0, approval: 'admin', visits, ...extra,
  });
  const beat = (base: string, project: string, port: number, c: unknown) =>
    fetch(`${base}/heartbeat`, { method: 'POST', body: JSON.stringify({ project, port, card: c }) });

  it('finds the teams an agent could visit from the cards runners report', async () => {
    const base = await serve();
    await beat(base, 'ops', 3001, card('ops', { visitTo: ['*'], hostFrom: [] }));
    await beat(base, 'billing', 3101, card('billing', { visitTo: [], hostFrom: ['ops'] }, { tags: ['invoices'] }));

    const teams = base.replace('/runners', '/teams');
    const res = await fetch(`${teams}?from=ops&intent=${encodeURIComponent('invoices for a customer')}`);
    const found = await res.json() as { teams: Array<{ team: string; visits?: unknown }> };
    expect(found.teams.map((t) => t.team)).toEqual(['billing']);
    expect(found.teams[0]).not.toHaveProperty('visits');
    expect((await fetch(teams)).status).toBe(400);
  });

  it('ignores a card a runner sends for a team other than its own', async () => {
    const base = await serve();
    await beat(base, 'ops', 3001, card('ops', { visitTo: ['*'], hostFrom: [] }));
    await beat(base, 'billing', 3101, card('payroll', { visitTo: [], hostFrom: ['*'] }));
    const found = await (await fetch(`${base.replace('/runners', '/teams')}?from=ops`)).json() as { teams: unknown[] };
    expect(found.teams).toEqual([]);
  });
});
