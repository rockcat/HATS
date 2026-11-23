/**
 * Permanent moves between teams. See docs/team-visits.md.
 *
 *   POST /api/v1/moves              { agent, from, to, note?, pack }
 *   GET  /api/v1/moves/:id
 *   GET  /api/v1/moves/:id/pack     the agent, as its old runner packed it
 *   POST /api/v1/moves/:id/done     the new team's runner has it running
 *
 * Only runners call these, with the installation's runner token: the old
 * team's runner, for an admin, and the new team's.
 */

import type { IncomingMessage } from 'http';
import { badRequest, fail, get, json, notFound, post, readJsonBody, type RequestContext, type Route } from '@hats/service-kit/index';
import { VisitRuleError } from '@hats/contracts/visit-record';
import type { MoveService } from '../visits/move-service.js';
import { onlyRunners } from './visits.js';

const BASE = '/api/v1/moves';

async function handled(ctx: RequestContext, status: number, action: () => Promise<unknown>): Promise<void> {
  try {
    json(ctx.res, status, await action());
  } catch (err) {
    if (err instanceof VisitRuleError) { fail(ctx.res, err.status, err.message); return; }
    throw err;
  }
}

export function moveRoutes(moves: MoveService, isRunner: (req: IncomingMessage) => boolean = () => true): Route[] {
  const id = (ctx: RequestContext) => ctx.params['id'] as string;
  return onlyRunners([
    post(BASE, async (ctx) => {
      const body = await readJsonBody<{ agent?: string; from?: string; to?: string; note?: string; pack?: unknown }>(ctx.req);
      if (!body?.agent || !body.from || !body.to || body.pack === undefined) {
        badRequest(ctx.res, 'agent, from, to and pack are required');
        return;
      }
      await handled(ctx, 201, () => moves.move({
        agent: body.agent!, from: body.from!, to: body.to!, pack: body.pack,
        ...(body.note?.trim() && { note: body.note.trim() }),
      }));
    }),

    get(`${BASE}/:id`, (ctx) => {
      const move = moves.get(id(ctx));
      if (!move) { notFound(ctx.res, 'Move'); return; }
      json(ctx.res, 200, move);
    }),

    get(`${BASE}/:id/pack`, async (ctx) => handled(ctx, 200, async () => {
      const pack = await moves.readPack(id(ctx));
      if (pack === undefined) throw new VisitRuleError(404, 'This move has no pack: it is done.');
      return pack;
    })),

    post(`${BASE}/:id/done`, async (ctx) => handled(ctx, 200, () => moves.done(id(ctx)))),
  ], isRunner);
}
