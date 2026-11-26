import { describe, expect, it } from 'vitest';
import { homeOf, hostsVisitors, mayVisit } from './visits.js';
import { createDeployedAgent, createProject } from './factories.js';
import { validateProject } from './validate.js';

describe('homeOf', () => {
  it('is the project holding the agent unless it says otherwise', () => {
    expect(homeOf({}, 'billing')).toBe('billing');
    expect(homeOf({ home: 'research' }, 'billing')).toBe('research');
  });
});

describe('mayVisit', () => {
  const team = (id: string, visitTo?: string[], hostFrom?: string[]) => ({ id, visits: { visitTo, hostFrom } });

  it('allows nothing by default', () => {
    expect(mayVisit({ id: 'a' }, { id: 'b' })).toBe(false);
  });

  it('needs both teams to agree', () => {
    expect(mayVisit(team('a', ['b']), team('b', [], ['a']))).toBe(true);
    expect(mayVisit(team('a', ['b']), team('b'))).toBe(false);          // the host has not agreed
    expect(mayVisit(team('a'), team('b', [], ['a']))).toBe(false);      // the home has not agreed
  });

  it('takes "*" as any team, and ignores case', () => {
    expect(mayVisit(team('A', ['*']), team('b', [], ['a']))).toBe(true);
    expect(mayVisit(team('a', ['B']), team('b', [], ['*']))).toBe(true);
  });

  it('never lets a team visit itself', () => {
    expect(mayVisit(team('a', ['*'], ['*']), team('A', ['*'], ['*']))).toBe(false);
  });
});

describe('hostsVisitors', () => {
  it('is true only when the team hosts someone', () => {
    expect(hostsVisitors(undefined)).toBe(false);
    expect(hostsVisitors({ hostFrom: [] })).toBe(false);
    expect(hostsVisitors({ hostFrom: ['research'] })).toBe(true);
  });
});

describe('the schemas', () => {
  it('accept a project with a visit policy, tags and a summary, and a member with a home', () => {
    const project = createProject({
      id: 'billing', name: 'Billing',
      settings: {
        summary: 'Invoices and payments.', tags: ['billing', 'stripe'],
        visits: { visitTo: ['research'], hostFrom: ['*'], approval: 'auto', maxHours: 4, memoryHome: 'summary' },
      },
      team: [createDeployedAgent({ name: 'Ann', home: 'research' })],
    });
    expect(validateProject(project)).toMatchObject({ valid: true });
  });

  it('refuse an unknown approval rule', () => {
    const project = createProject({ id: 'billing', name: 'Billing' });
    const bad = { ...project, settings: { visits: { approval: 'never' } } };
    expect(validateProject(bad).valid).toBe(false);
  });
});
