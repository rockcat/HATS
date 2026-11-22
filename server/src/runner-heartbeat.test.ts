import { describe, it, expect } from 'vitest';
import { startHeartbeat } from './runner-heartbeat.js';

describe('reporting in to the runner manager', () => {
  it('says which project it holds and on which port, straight away', async () => {
    const sent: Array<{ url: string; body: unknown }> = [];
    let project = 'paige';
    const stop = startHeartbeat({
      managerUrl: 'http://runner-manager:3080/', project: () => project, port: 3002,
      fetchImpl: (async (url: string, init?: RequestInit) => {
        sent.push({ url, body: JSON.parse(String(init?.body)) });
        return new Response(null, { status: 204 });
      }) as typeof fetch,
    });
    await new Promise((r) => setTimeout(r, 10));
    stop();
    project = 'evan';

    expect(sent).toEqual([{ url: 'http://runner-manager:3080/api/v1/runners/heartbeat', body: { project: 'paige', port: 3002 } }]);
  });

  it('carries on when the manager is not there', async () => {
    const stop = startHeartbeat({
      managerUrl: 'http://nowhere', project: () => 'p', port: 1,
      fetchImpl: (async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch,
    });
    await new Promise((r) => setTimeout(r, 10));
    stop();
  });
});
