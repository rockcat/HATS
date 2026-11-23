/**
 * Visits between teams. See docs/team-visits.md.
 *
 *   POST /api/v1/visits                      ask: { agent, home, host, reason }
 *   GET  /api/v1/visits[?project=&open=true] visits involving a project
 *   GET  /api/v1/visits/:id
 *   POST /api/v1/visits/:id/approve          the host agrees      { note? }
 *   POST /api/v1/visits/:id/refuse           the host does not    { note? }
 *   POST /api/v1/visits/:id/cancel           before leaving       { note? }
 *   POST /api/v1/visits/:id/leave            the agent left home  { pack }
 *   POST /api/v1/visits/:id/return           it left the host     { result, ended, pack? }
 *   POST /api/v1/visits/:id/home             home has it back
 *   POST /api/v1/visits/:id/recall           home wants it back   { by?, note? }
 *   GET  /api/v1/visits/:id/pack/:direction  the travel pack, out or back
 *
 * Runners call these, with the installation's runner token (HATS_RUNNER_TOKEN):
 * the agent's home runner to ask and leave, the host's runner to approve for
 * an admin and to send the agent back.
 */

import { badRequest, fail, get, json, notFound, post, readJsonBody, type RequestContext, type Route } from '@hats/service-kit/index';
import type { IncomingMessage } from 'http';
import { VisitRuleError } from '@hats/contracts/visit-record';
import type { VisitEnd, VisitReason, VisitResult } from '@hats/contracts/types';
import type { PackDirection, VisitService } from '../visits/visit-service.js';

const BASE = '/api/v1/visits';
const OUTCOMES = ['done', 'partial', 'failed'];

async function handled(ctx: RequestContext, status: number, action: () => Promise<unknown>): Promise<void> {
  try {
    json(ctx.res, status, await action());
  } catch (err) {
    if (err instanceof VisitRuleError) { fail(ctx.res, err.status, err.message); return; }
    throw err;
  }
}

const note = async (ctx: RequestContext) => (await readJsonBody<{ note?: string }>(ctx.req))?.note?.trim() || undefined;

/** Only runners may touch a visit: with the installation's runner token, when one is set. */
export function onlyRunners(routes: Route[], isRunner: (req: IncomingMessage) => boolean): Route[] {
  return routes.map((route) => ({
    ...route,
    handler: (ctx: RequestContext) => (isRunner(ctx.req)
      ? route.handler(ctx)
      : fail(ctx.res, 401, 'Only a runner of this installation may do this')),
  }));
}

export function visitRoutes(visits: VisitService, isRunner: (req: IncomingMessage) => boolean = () => true): Route[] {
  return onlyRunners(routesFor(visits), isRunner);
}

function routesFor(visits: VisitService): Route[] {
  const id = (ctx: RequestContext) => ctx.params['id'] as string;

  return [
    post(BASE, async (ctx) => {
      const body = await readJsonBody<{ agent?: string; home?: string; host?: string; reason?: VisitReason }>(ctx.req);
      if (!body?.agent || !body.home || !body.host || !body.reason) {
        badRequest(ctx.res, 'agent, home, host and reason are required');
        return;
      }
      await handled(ctx, 201, () => visits.request({ agent: body.agent!, home: body.home!, host: body.host!, reason: body.reason! }));
    }),

    get(BASE, ({ res, query }) => {
      json(res, 200, { visits: visits.list(query.get('project') ?? undefined, query.get('open') === 'true') });
    }),

    get(`${BASE}/:id`, (ctx) => {
      const visit = visits.get(id(ctx));
      if (!visit) { notFound(ctx.res, 'Visit'); return; }
      json(ctx.res, 200, visit);
    }),

    post(`${BASE}/:id/approve`, async (ctx) => handled(ctx, 200, async () => visits.approve(id(ctx), await note(ctx)))),
    post(`${BASE}/:id/refuse`, async (ctx) => handled(ctx, 200, async () => visits.refuse(id(ctx), await note(ctx)))),
    post(`${BASE}/:id/cancel`, async (ctx) => handled(ctx, 200, async () => visits.cancel(id(ctx), await note(ctx)))),

    post(`${BASE}/:id/leave`, async (ctx) => {
      const body = await readJsonBody<{ pack?: unknown }>(ctx.req);
      await handled(ctx, 200, () => visits.leave(id(ctx), body?.pack ?? {}));
    }),

    post(`${BASE}/:id/return`, async (ctx) => {
      const body = await readJsonBody<{ result?: VisitResult; ended?: { by: VisitEnd; note?: string }; pack?: unknown }>(ctx.req);
      if (!body?.result?.summary || !OUTCOMES.includes(body.result.outcome)) {
        badRequest(ctx.res, `result needs a summary and an outcome: ${OUTCOMES.join(', ')}`);
        return;
      }
      await handled(ctx, 200, () => visits.return(id(ctx), body.result!, body.ended ?? { by: 'finished' }, body.pack));
    }),

    post(`${BASE}/:id/home`, async (ctx) => handled(ctx, 200, () => visits.home(id(ctx)))),

    post(`${BASE}/:id/recall`, async (ctx) => {
      const body = await readJsonBody<{ by?: string; note?: string }>(ctx.req);
      const by = body?.by === 'reason-gone' ? 'reason-gone' : 'recalled';
      await handled(ctx, 200, () => visits.recall(id(ctx), by, body?.note?.trim() || undefined));
    }),

    get(`${BASE}/:id/pack/:direction`, async (ctx) => {
      const direction = ctx.params['direction'] as PackDirection;
      if (direction !== 'out' && direction !== 'back') { badRequest(ctx.res, 'direction is out or back'); return; }
      await handled(ctx, 200, async () => {
        const pack = await visits.readPack(id(ctx), direction);
        if (pack === undefined) throw new VisitRuleError(404, `This visit has no ${direction} pack.`);
        return pack;
      });
    }),
  ];
}
