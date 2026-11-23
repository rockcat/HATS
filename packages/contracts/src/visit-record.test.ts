import { describe, expect, it } from 'vitest';
import { createDeployedAgent, createProject } from './factories.js';
import { validateProject } from './validate.js';
import type { DeployedAgent, ProjectDefinition, Visit, VisitPolicy } from './types.js';
import { advance, comeHome, isOpen, leaveHome, moveProblem, moveTeams, visitDeadline, visitProblem, VisitRuleError } from './visit-record.js';

const ann = (extra: Partial<DeployedAgent> = {}) => createDeployedAgent({ instanceId: 'id-ann', name: 'Ann', ...extra });

const project = (id: string, visits: VisitPolicy, team: DeployedAgent[] = [], servers: string[] = []): ProjectDefinition =>
  createProject({
    id, name: id[0]!.toUpperCase() + id.slice(1), team, settings: { visits },
    mcpServers: servers.map((name) => ({ name, config: { transport: 'stdio' as const } })),
  });

const reason = { ticket: 'TKT-1', purpose: 'Read the invoices', expectedResult: 'The totals per month' };

const visit = (extra: Partial<Visit> = {}): Visit => ({
  id: 'v1', agent: { instanceId: 'id-ann', name: 'Ann' }, home: 'ops', host: 'billing', reason,
  state: 'requested', approval: 'admin', memoryHome: 'summary',
  requestedAt: 't0', updatedAt: 't0', history: [{ state: 'requested', at: 't0' }], ...extra,
});

describe('visitProblem', () => {
  const ops = project('ops', { visitTo: ['billing'] }, [ann()]);
  const billing = project('billing', { hostFrom: ['ops'] }, [], ['postgres']);

  it('allows a visit both teams agreed to, for a ticket, with a purpose and a result', () => {
    expect(visitProblem(ops, billing, 'id-ann', reason, [])).toBeNull();
  });

  it('refuses one the host has not agreed to', () => {
    const closed = project('billing', { hostFrom: [] });
    expect(visitProblem(ops, closed, 'id-ann', reason, [])).toMatch(/not both agreed/);
  });

  it('refuses one with no ticket, purpose or result', () => {
    expect(visitProblem(ops, billing, 'id-ann', { ...reason, ticket: ' ' }, [])).toMatch(/home ticket/);
    expect(visitProblem(ops, billing, 'id-ann', { ...reason, expectedResult: '' }, [])).toMatch(/purpose and the result/);
  });

  it('refuses a host without a tool the agent cannot work without', () => {
    const needy = project('ops', { visitTo: ['billing'] }, [ann({ needs: { tools: { required: ['stripe'] } } })]);
    expect(visitProblem(needy, billing, 'id-ann', reason, [])).toMatch(/does not have stripe/);
  });

  it('refuses an agent already away, already visiting, or already asking', () => {
    const away = project('ops', { visitTo: ['*'] }, [ann({ away: { visit: 'v0', host: 'research' } })]);
    expect(visitProblem(away, billing, 'id-ann', reason, [])).toMatch(/already away/);
    const visitor = project('ops', { visitTo: ['*'] }, [ann({ visit: 'v0', home: 'research' })]);
    expect(visitProblem(visitor, billing, 'id-ann', reason, [])).toMatch(/visit onwards/);
    expect(visitProblem(ops, billing, 'id-ann', reason, [visit()])).toMatch(/already asked/);
  });

  it('refuses an agent that is not on the team', () => {
    expect(visitProblem(ops, billing, 'id-nobody', reason, [])).toMatch(/no agent/);
  });
});

describe('advance', () => {
  it('moves a visit on and records when', () => {
    const next = advance(visit(), 'approved', 't1', 'auto');
    expect(next).toMatchObject({ state: 'approved', updatedAt: 't1' });
    expect(next.history.at(-1)).toEqual({ state: 'approved', at: 't1', note: 'auto' });
  });

  it('refuses a step out of order', () => {
    expect(() => advance(visit(), 'visiting', 't1')).toThrow(VisitRuleError);
    expect(() => advance(visit({ state: 'home' }), 'cancelled', 't1')).toThrow(/home cannot become cancelled/);
  });

  it('knows a finished visit', () => {
    expect(isOpen(visit())).toBe(true);
    expect(isOpen(visit({ state: 'refused' }))).toBe(false);
  });
});

describe('leaving and coming home', () => {
  const ops = project('ops', { visitTo: ['billing'] }, [ann(), createDeployedAgent({ instanceId: 'id-bo', name: 'Bo' })]);
  const billing = project('billing', { hostFrom: ['ops'] }, [createDeployedAgent({ instanceId: 'id-cy', name: 'Cy' })]);

  it('keeps the agent\'s place at home and gives the host a visitor belonging to home', () => {
    const teams = leaveHome(ops, billing, visit());
    expect(teams.home.find((a) => a.name === 'Ann')?.away).toEqual({ visit: 'v1', host: 'billing' });
    const visitor = teams.host.find((a) => a.name === 'Ann');
    expect(visitor).toMatchObject({ home: 'ops', visit: 'v1' });
    expect(visitor).not.toHaveProperty('away');
    expect(teams.host).toHaveLength(2);
  });

  it('leaves both teams valid', () => {
    const teams = leaveHome(ops, billing, visit());
    expect(validateProject({ ...ops, team: teams.home }).valid).toBe(true);
    expect(validateProject({ ...billing, team: teams.host }).valid).toBe(true);
  });

  it('puts things back on the way home', () => {
    const away = leaveHome(ops, billing, visit());
    const back = comeHome({ ...ops, team: away.home }, { ...billing, team: away.host }, visit());
    expect(back.host.map((a) => a.name)).toEqual(['Cy']);
    expect(back.home.find((a) => a.name === 'Ann')).not.toHaveProperty('away');
  });

  it('refuses to leave without the agent', () => {
    expect(() => leaveHome({ ...ops, team: [] }, billing, visit())).toThrow(VisitRuleError);
  });
});

describe('visitDeadline', () => {
  it('takes the shorter of the two teams\' limits, or none', () => {
    const from = new Date('2026-11-23T10:00:00Z');
    expect(visitDeadline(project('a', { maxHours: 4 }), project('b', { maxHours: 2 }), from)).toBe('2026-11-23T12:00:00.000Z');
    expect(visitDeadline(project('a', {}), project('b', {}), from)).toBeUndefined();
  });
});

describe('permanent moves', () => {
  const ops = project('ops', {}, [ann(), createDeployedAgent({ instanceId: 'id-bo', name: 'Bo' })]);
  const billing = project('billing', { hostFrom: ['ops'] }, [createDeployedAgent({ instanceId: 'id-cy', name: 'Cy' })]);

  it('needs the new team to take agents from the old one, and nothing in the way', () => {
    expect(moveProblem(ops, billing, 'id-ann', [])).toBeNull();
    expect(moveProblem(ops, project('billing', { hostFrom: [] }), 'id-ann', [])).toMatch(/does not take agents/);
    expect(moveProblem(ops, billing, 'id-ann', [visit({ state: 'approved' })])).toMatch(/visit under way/);
    const away = project('ops', {}, [ann({ away: { visit: 'v0', host: 'research' } })]);
    expect(moveProblem(away, billing, 'id-ann', [])).toMatch(/already/);
    const clash = project('billing', { hostFrom: ['*'] }, [createDeployedAgent({ instanceId: 'id-x', name: 'ann' })]);
    expect(moveProblem(ops, clash, 'id-ann', [])).toMatch(/already has someone called Ann/);
    expect(moveProblem(ops, ops, 'id-ann', [])).toMatch(/already on/);
  });

  it('takes the agent off one team and puts it on the other, marked with the move', () => {
    const teams = moveTeams(ops, billing, 'm1', 'id-ann');
    expect(teams.from.map((a) => a.name)).toEqual(['Bo']);
    expect(teams.to.map((a) => a.name)).toEqual(['Cy', 'Ann']);
    expect(teams.to[1]).toMatchObject({ instanceId: 'id-ann', move: 'm1' });
    expect(validateProject({ ...billing, team: teams.to }).valid).toBe(true);
  });
});
