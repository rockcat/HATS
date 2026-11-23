import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'net';
import { get, json, runnerGate, startService, type RunningService } from '@hats/service-kit/index';
import { onlyRunners } from './visits.js';

let running: RunningService | null = null;
afterEach(async () => { await running?.stop(); running = null; });

describe('visit routes', () => {
  it('answer only runners carrying the installation\'s token', async () => {
    const routes = onlyRunners([get('/api/v1/visits', ({ res }) => json(res, 200, { visits: [] }))], runnerGate('s3cret', () => {}));
    running = await startService({ name: 'test', port: 0, routes });
    const url = `http://127.0.0.1:${(running.server.address() as AddressInfo).port}/api/v1/visits`;

    expect((await fetch(url)).status).toBe(401);
    expect((await fetch(url, { headers: { Authorization: 'Bearer nope' } })).status).toBe(401);
    expect((await fetch(url, { headers: { Authorization: 'Bearer s3cret' } })).status).toBe(200);
  });
});
