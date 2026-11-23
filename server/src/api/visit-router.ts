// ── Visits, for the dashboard ────────────────────────────────────────────────
//
//   GET  /api/visits                 this team's unfinished visits, out and in
//   POST /api/visits/:id/approve     a visit here: agree       { note? }  admin
//   POST /api/visits/:id/refuse      a visit here: do not      { note? }  admin
//   POST /api/visits/:id/recall      one of ours: come back    { note? }  admin
//   POST /api/visits/:id/end         a visitor here: go home   { note? }  admin
//
// See docs/team-visits.md in the HATS repository.

import type { IncomingMessage, ServerResponse } from 'http';
import type { VisitCoordinator } from '../visits/visit-coordinator.js';

export interface VisitRouterDeps {
  /** The open project's coordinator; null without a Project Server. */
  visits(): VisitCoordinator | null;
  isAdmin(req: IncomingMessage): boolean;
  json(res: ServerResponse, status: number, body: unknown): void;
  readBody(req: IncomingMessage): Promise<string>;
}

const STEP = /^\/api\/visits\/([^/]+)\/(approve|refuse|recall|end)$/;

export async function handleVisitRoutes(
  d: VisitRouterDeps, pathname: string, method: string, req: IncomingMessage, res: ServerResponse,
): Promise<boolean> {
  if (pathname !== '/api/visits' && !pathname.startsWith('/api/visits/')) return false;
  const visits = d.visits();
  if (!visits) { d.json(res, 404, { error: 'Visits need a Project Server, and this runner has none.' }); return true; }

  if (pathname === '/api/visits' && method === 'GET') {
    try { d.json(res, 200, { visits: await visits.list() }); }
    catch (err) { d.json(res, 502, { error: (err as Error).message }); }
    return true;
  }

  const step = STEP.exec(pathname);
  if (!step || method !== 'POST') return false;
  if (!d.isAdmin(req)) { d.json(res, 403, { error: 'Only an admin can decide on visits.' }); return true; }
  const id = decodeURIComponent(step[1]!);
  const note = ((JSON.parse((await d.readBody(req)) || '{}') as { note?: string }).note ?? '').trim() || undefined;
  try {
    switch (step[2]) {
      case 'approve': d.json(res, 200, await visits.decide(id, true, note)); break;
      case 'refuse': d.json(res, 200, await visits.decide(id, false, note)); break;
      case 'recall': d.json(res, 200, await visits.recall(id, note)); break;
      default: await visits.end(id, note); d.json(res, 202, { ok: true });
    }
  } catch (err) {
    const status = (err as { status?: number }).status;
    d.json(res, status && status >= 400 && status < 500 ? status : 409, { error: (err as Error).message });
  }
  return true;
}
