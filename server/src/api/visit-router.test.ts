import { describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';
import { handleVisitRoutes } from './visit-router.js';
import type { VisitCoordinator } from '../visits/visit-coordinator.js';

function call(path: string, method: string, opts: { admin?: boolean; visits?: Partial<VisitCoordinator> | null; body?: unknown } = {}) {
  const sent: Array<{ status: number; body: unknown }> = [];
  const visits = opts.visits === undefined ? {
    list: vi.fn(async () => []), decide: vi.fn(async () => ({ state: 'approved' })),
    recall: vi.fn(async () => ({ state: 'visiting' })), end: vi.fn(async () => {}),
  } : opts.visits;
  const handled = handleVisitRoutes({
    visits: () => visits as VisitCoordinator | null,
    isAdmin: () => opts.admin ?? false,
    json: (_r, status, body) => { sent.push({ status, body }); },
    readBody: async () => JSON.stringify(opts.body ?? {}),
  }, path, method, {} as IncomingMessage, {} as ServerResponse);
  return { handled, sent, visits };
}

describe('the dashboard\'s visit routes', () => {
  it('lists visits to anyone signed in', async () => {
    const { handled, sent } = call('/api/visits', 'GET');
    expect(await handled).toBe(true);
    expect(sent).toEqual([{ status: 200, body: { visits: [] } }]);
  });

  it('lets only an admin decide', async () => {
    const { sent, visits } = call('/api/visits/v1/approve', 'POST', { body: { note: 'ok' } });
    await new Promise((r) => setTimeout(r, 0));
    expect(sent[0]?.status).toBe(403);
    expect(visits!.decide).not.toHaveBeenCalled();
  });

  it('passes an admin\'s decision on, with the note', async () => {
    const { handled, visits } = call('/api/visits/v1/refuse', 'POST', { admin: true, body: { note: ' busy ' } });
    await handled;
    expect(visits!.decide).toHaveBeenCalledWith('v1', false, 'busy');
  });

  it('says so when there is no Project Server for visits', async () => {
    const { handled, sent } = call('/api/visits', 'GET', { visits: null });
    await handled;
    expect(sent[0]?.status).toBe(404);
  });

  it('leaves other routes alone', async () => {
    expect(await call('/api/agents', 'GET').handled).toBe(false);
  });
});
