import { describe, expect, it } from 'vitest';
import type { TeamCard } from '@hats/contracts/types';
import { discoverTeams, score, words } from './discovery.js';

const card = (team: string, extra: Partial<TeamCard> = {}): TeamCard => ({
  team, name: team[0]!.toUpperCase() + team.slice(1), summary: '', tags: [], members: [], tools: [],
  models: [], hosting: true, approval: 'admin', visits: { visitTo: [], hostFrom: [] }, ...extra,
});

describe('discoverTeams', () => {
  const home = card('ops', { visits: { visitTo: ['*'], hostFrom: [] }, hosting: false });
  const billing = card('billing', {
    summary: 'Invoices and payments.', tags: ['billing', 'stripe'],
    tools: [{ name: 'postgres', description: 'Query the invoice database.' }],
    visits: { visitTo: [], hostFrom: ['ops'] },
  });
  const research = card('research', {
    summary: 'Market research.', tags: ['research'], visits: { visitTo: [], hostFrom: ['*'] },
  });

  it('returns only teams both sides allow, best match first', () => {
    const teams = discoverTeams([home, billing, research], 'ops', 'EU customer invoice history');
    expect(teams.map((t) => t.team)).toEqual(['billing', 'research']);
  });

  it('never returns a team that has not agreed to host this one', () => {
    const closed = card('hr', { tags: ['invoice'], visits: { visitTo: [], hostFrom: ['research'] } });
    expect(discoverTeams([home, closed], 'ops', 'invoice').map((t) => t.team)).toEqual([]);
  });

  it('returns nothing when the asking team has agreed to visit nobody', () => {
    const shut = card('ops', { visits: { visitTo: [], hostFrom: [] } });
    expect(discoverTeams([shut, billing], 'ops', 'invoices')).toEqual([]);
  });

  it('returns nothing for a team it has no card for, since its policy is unknown', () => {
    expect(discoverTeams([billing], 'ops', 'invoices')).toEqual([]);
  });

  it('never returns the asking team, or a team that hosts nobody', () => {
    const quiet = card('quiet', { hosting: false, visits: { visitTo: [], hostFrom: ['ops'] } });
    const self = card('ops', { visits: { visitTo: ['*'], hostFrom: ['*'] } });
    expect(discoverTeams([self, quiet], 'ops', '').map((t) => t.team)).toEqual([]);
  });

  it('keeps to the limit, and leaves out who may visit whom', () => {
    const teams = discoverTeams([home, billing, research], 'ops', 'invoices', 1);
    expect(teams).toHaveLength(1);
    expect(teams[0]).not.toHaveProperty('visits');
  });
});

describe('score', () => {
  it('weighs a tag above a tool above anything else', () => {
    const c = card('x', { tags: ['billing'], tools: [{ name: 'stripe' }], summary: 'refunds' });
    expect(score(c, words('billing'))).toBe(3);
    expect(score(c, words('stripe'))).toBe(2);
    expect(score(c, words('refunds'))).toBe(1);
    expect(score(c, words('the and for'))).toBe(0);
  });
});
