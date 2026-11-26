import { describe, it, expect } from 'vitest';
import { ownContainer, sayGoodbye, startHeartbeat } from './runner-heartbeat.js';

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

describe('stopping', () => {
  it('gives its container when it runs in Docker', async () => {
    const sent: unknown[] = [];
    const stop = startHeartbeat({
      managerUrl: 'http://runner-manager:3080', project: () => 'paige', port: 3002, container: 'abc123',
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        sent.push(JSON.parse(String(init?.body)));
        return new Response(null, { status: 204 });
      }) as typeof fetch,
    });
    await new Promise((r) => setTimeout(r, 10));
    stop();
    expect(sent).toEqual([{ project: 'paige', port: 3002, container: 'abc123' }]);
  });

  it('knows its container only inside Docker', () => {
    expect(ownContainer(true, 'abc123')).toBe('abc123');
    expect(ownContainer(false, 'my-laptop')).toBeUndefined();
  });

  it('says goodbye, and never holds up stopping when the manager is gone', async () => {
    const sent: Array<{ url: string; body: unknown }> = [];
    await sayGoodbye({
      managerUrl: 'http://runner-manager:3080/', project: () => 'paige',
      fetchImpl: (async (url: string, init?: RequestInit) => {
        sent.push({ url, body: JSON.parse(String(init?.body)) });
        return new Response(null, { status: 204 });
      }) as typeof fetch,
    });
    expect(sent).toEqual([{ url: 'http://runner-manager:3080/api/v1/runners/goodbye', body: { project: 'paige' } }]);

    await sayGoodbye({
      managerUrl: 'http://nowhere', project: () => 'p',
      fetchImpl: (async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch,
    });
  });
});
