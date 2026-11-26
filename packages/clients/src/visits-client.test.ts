import { describe, it, expect, vi, afterEach } from 'vitest';
import { VisitsClient } from './visits-client.js';

const answer = (status: number, body: unknown) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));

afterEach(() => vi.unstubAllGlobals());

describe('the visits client', () => {
  const client = new VisitsClient('http://ps');
  const req = { agent: 'a1', home: 'website', host: 'Insights', reason: { ticket: 'TKT-001', purpose: 'p', expectedResult: 'r' } };

  it('returns the visit the Project Server made', async () => {
    answer(201, { id: 'v1', host: 'insights', state: 'requested' });
    expect((await client.request(req)).host).toBe('insights');
  });

  it('says there is no such team, rather than returning nothing dressed as a visit', async () => {
    answer(404, { error: 'There is no project Insights.' });
    await expect(client.request(req)).rejects.toThrow(/no team "Insights"/);
  });

  it('says there is no such visit when a step finds none', async () => {
    answer(404, { error: 'no' });
    await expect(client.approve('v9')).rejects.toThrow(/no visit v9/);
  });
});
