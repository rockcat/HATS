import { describe, it, expect } from 'vitest';
import { resolveTeam } from './team-name.js';

const projects = [
  { id: 'insights', name: 'Insights' },
  { id: 'sales-ops', name: 'Sales Ops' },
];

describe('the team an agent means', () => {
  it('takes the id as it is', () => {
    expect(resolveTeam('insights', projects)).toBe('insights');
  });

  it('takes the name, as discover_teams shows it, in any case', () => {
    expect(resolveTeam('Insights', projects)).toBe('insights');
    expect(resolveTeam(' sales ops ', projects)).toBe('sales-ops');
    expect(resolveTeam('SALES-OPS', projects)).toBe('sales-ops');
  });

  it('passes an unknown team on, for the Project Server to refuse', () => {
    expect(resolveTeam('Marketing', projects)).toBe('Marketing');
    expect(resolveTeam('Insights', [])).toBe('Insights');
  });
});
