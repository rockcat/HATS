import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain JS module, shipped to the browser as-is
import { groupVisits } from './visits.js';

const visit = (home: string, host: string, state: string) => ({ id: `${home}-${host}-${state}`, home, host, state });

describe('groupVisits', () => {
  it('sorts a team\'s visits by what can be done about them here', () => {
    const groups = groupVisits([
      visit('ops', 'billing', 'requested'),
      visit('ops', 'billing', 'visiting'),
      visit('billing', 'research', 'visiting'),
      visit('billing', 'research', 'approved'),
    ], 'Billing');
    expect(groups.asking.map((v: { id: string }) => v.id)).toEqual(['ops-billing-requested']);
    expect(groups.visiting.map((v: { id: string }) => v.id)).toEqual(['ops-billing-visiting']);
    expect(groups.away.map((v: { id: string }) => v.id)).toEqual(['billing-research-visiting']);
    expect(groups.waiting.map((v: { id: string }) => v.id)).toEqual(['billing-research-approved']);
  });
});
