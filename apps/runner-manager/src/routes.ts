// ── The runner manager's API ─────────────────────────────────────────────────
//
//   POST   /api/v1/runners/heartbeat   a runner reporting in (no sign-in: it
//                                      is on the services' network, and the
//                                      manager's port is not published)
//   GET    /api/v1/runners             every project, with its runner
//   POST   /api/v1/runners             launch one: { project }     admin only
//   DELETE /api/v1/runners/:project    stop and remove one          admin only
//
// The dashboard reaches these through its runner's /api/runners, which
// passes the caller's sign-in along.

import { badRequest, del, fail, get, json, noContent, post, readJsonBody, type Route } from '@hats/service-kit/index';
import type { Authenticator } from '@hats/auth/authenticator';
import type { IncomingMessage, ServerResponse } from 'http';
import { LaunchError, type RunnerManager } from './manager.js';
import type { Registry } from './registry.js';
import { DockerError } from './docker.js';
import type { Heartbeat } from './types.js';

const BASE = '/api/v1/runners';

export interface RouteDeps {
  manager: RunnerManager;
  registry: Registry;
  /** Null when there is no auth service: then nobody can be checked, and nothing is listed. */
  auth: Authenticator | null;
  /** Whether Docker can be reached, so the dashboard knows to offer Launch. */
  canLaunch: () => boolean;
}

export function runnerRoutes(d: RouteDeps): Route[] {
  /** The caller, or null once a refusal has been sent. */
  const caller = async (req: IncomingMessage, res: ServerResponse, admin: boolean) => {
    const session = d.auth ? await d.auth.authenticate(req) : null;
    if (!session) { fail(res, 401, 'Not signed in'); return null; }
    if (admin && session.role !== 'admin') { fail(res, 403, 'Only an admin can start or stop runners'); return null; }
    return session;
  };

  const failed = (res: ServerResponse, err: unknown) => {
    if (err instanceof LaunchError) { fail(res, err.status, err.message); return; }
    if (err instanceof DockerError) {
      const image = /no such image/i.test(err.message) ? ' Pull the runner image first: docker compose pull.' : '';
      fail(res, 503, `Docker: ${err.message}.${image}`);
      return;
    }
    throw err;
  };

  return [
    post(`${BASE}/heartbeat`, async ({ req, res }) => {
      const beat = await readJsonBody<Partial<Heartbeat>>(req);
      if (!beat?.project || !Number.isInteger(beat.port)) { badRequest(res, 'project and port are required'); return; }
      d.registry.heartbeat({ project: beat.project, port: beat.port!, ...(beat.url && { url: beat.url }) });
      noContent(res);
    }),

    get(BASE, async ({ req, res }) => {
      const session = await caller(req, res, false);
      if (!session) return;
      json(res, 200, {
        projects: await d.manager.overview(),
        canLaunch: session.role === 'admin' && d.canLaunch(),
      });
    }),

    post(BASE, async ({ req, res }) => {
      if (!(await caller(req, res, true))) return;
      const body = await readJsonBody<{ project?: string }>(req);
      try {
        json(res, 201, await d.manager.launch((body?.project ?? '').trim()));
      } catch (err) { failed(res, err); }
    }),

    del(`${BASE}/:project`, async ({ req, res, params }) => {
      if (!(await caller(req, res, true))) return;
      try {
        await d.manager.remove(decodeURIComponent(params['project'] as string));
        noContent(res);
      } catch (err) { failed(res, err); }
    }),
  ];
}
