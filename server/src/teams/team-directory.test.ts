import { describe, expect, it, vi } from 'vitest';
import { formatTeams, TeamDirectory, type VisibleCard } from './team-directory.js';

const billing: VisibleCard = {
  team: 'billing', name: 'Billing', summary: 'Invoices and payments.', tags: ['billing', 'stripe'],
  members: [{ name: 'Ann', hats: ['white'], specialisation: 'reconciliation' }, { name: 'Bo', hats: ['red'] }],
  tools: [{ name: 'postgres', description: 'Query the invoice database.' }, { name: 'stripe' }],
  models: ['anthropic'], hosting: true, approval: 'admin',
};

describe('TeamDirectory', () => {
  it('is available only while this team may visit someone', () => {
    let visitTo: string[] = [];
    const dir = new TeamDirectory({
      managerUrl: 'http://rm', team: () => 'ops',
      definition: () => ({ settings: { visits: { visitTo } } }),
    });
    expect(dir.available()).toBe(false);
    visitTo = ['billing'];
    expect(dir.available()).toBe(true);
  });

  it('asks the runner manager as this team, with what is needed', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ teams: [billing] })));
    const dir = new TeamDirectory({
      managerUrl: 'http://rm:3080/', team: () => 'ops', definition: () => undefined,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await dir.discover('EU invoices')).toEqual([billing]);
    expect(fetchImpl).toHaveBeenCalledWith('http://rm:3080/api/v1/teams?from=ops&intent=EU+invoices', expect.anything());
  });

  it('says when the runner manager refuses', async () => {
    const dir = new TeamDirectory({
      managerUrl: 'http://rm', team: () => 'ops', definition: () => undefined,
      fetchImpl: (async () => new Response('', { status: 500 })) as unknown as typeof fetch,
    });
    await expect(dir.discover('x')).rejects.toThrow('500');
  });
});

describe('formatTeams', () => {
  it('describes each team in a few lines, and what to do next', () => {
    const text = formatTeams([billing]);
    expect(text).toContain('1. Billing (billing): Invoices and payments.');
    expect(text).toContain('Works on: billing, stripe');
    expect(text).toContain('Tools: postgres (Query the invoice database.); stripe');
    expect(text).toContain('Members: Ann, reconciliation; Bo');
    expect(text).toContain('wait for one of its admins');
    expect(text).toContain('escalate_to_human');
  });

  it('says plainly when nothing matches', () => {
    expect(formatTeams([])).toContain('No team you could visit matches that.');
  });
});
