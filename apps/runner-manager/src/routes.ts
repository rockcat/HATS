// ── The runner manager's API ─────────────────────────────────────────────────
//
//   POST   /api/v1/runners/heartbeat   a runner reporting in (with the runner
//                                      token, HATS_RUNNER_TOKEN, rather than
//                                      a person's sign-in)
//   POST   /api/v1/runners/goodbye     a runner stopping: { project }  (likewise)
//   GET    /api/v1/runners             every project, with its runner
//   POST   /api/v1/runners             launch one, or start a stopped one again:
//                                      { project }                  admin only
//   POST   /api/v1/runners/:project/stop
//                                      stop one, letting it save     admin only
//   DELETE /api/v1/runners/:project    stop and remove one          admin only
//   GET    /api/v1/teams?from=&intent=&limit=
//                                      teams an agent of `from` could visit,
//                                      best match first (the runner token, as
//                                      for report-ins: runners ask on behalf
//                                      of their agents)
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
import { DEFAULT_LIMIT, discoverTeams } from './discovery.js';

const BASE = '/api/v1/runners';

export interface RouteDeps {
  manager: RunnerManager;
  registry: Registry;
  /** Null when there is no auth service: then nobody can be checked, and nothing is listed. */
  auth: Authenticator | null;
  /** Whether Docker can be reached, so the dashboard knows to offer Launch. */
  canLaunch: () => boolean;
  /** Whether a request comes from a runner: it carries the installation's runner token. */
  isRunner?: (req: IncomingMessage) => boolean;
}

export function runnerRoutes(d: RouteDeps): Route[] {
  /** False, with a refusal sent, when the caller is not a runner. */
  const runner = (req: IncomingMessage, res: ServerResponse) => {
    if (d.isRunner && !d.isRunner(req)) { fail(res, 401, 'Only a runner of this installation may do this'); return false; }
    return true;
  };

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
      if (!runner(req, res)) return;
      const beat = await readJsonBody<Partial<Heartbeat>>(req);
      if (!beat?.project || !Number.isInteger(beat.port)) { badRequest(res, 'project and port are required'); return; }
      // A runner speaks for its own team only.
      const card = beat.card?.team?.toLowerCase() === beat.project.toLowerCase() ? beat.card : undefined;
      d.registry.heartbeat({
        project: beat.project, port: beat.port!,
        ...(beat.url && { url: beat.url }),
        ...(beat.container && { container: beat.container }),
        ...(card && { card }),
      });
      noContent(res);
    }),

    get('/api/v1/teams', ({ req, res, query }) => {
      if (!runner(req, res)) return;
      const from = query.get('from')?.trim();
      if (!from) { badRequest(res, 'from is required: the team asking'); return; }
      const limit = Number(query.get('limit') ?? DEFAULT_LIMIT);
      json(res, 200, {
        teams: discoverTeams(d.registry.cards(), from, query.get('intent') ?? '',
          Number.isFinite(limit) ? Math.min(limit, 10) : DEFAULT_LIMIT),
      });
    }),

    post(`${BASE}/goodbye`, async ({ req, res }) => {
      if (!runner(req, res)) return;
      const body = await readJsonBody<{ project?: string }>(req);
      if (!body?.project) { badRequest(res, 'project is required'); return; }
      d.registry.goodbye(body.project);
      noContent(res);
    }),

    post(`${BASE}/:project/stop`, async ({ req, res, params }) => {
      if (!(await caller(req, res, true))) return;
      try {
        await d.manager.stop(decodeURIComponent(params['project'] as string));
        noContent(res);
      } catch (err) { failed(res, err); }
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
