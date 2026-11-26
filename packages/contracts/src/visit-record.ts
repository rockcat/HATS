/**
 * The rules of a visit: who may ask, how its record moves on, and what leaving
 * and coming home do to the two teams. Plain functions over plain data, so
 * the Project Server applies them and anything else can preview them. See
 * docs/team-visits.md in the HATS repository.
 */

import type { DeployedAgent, ProjectDefinition, Visit, VisitReason, VisitState } from './types.js';
import { hostsVisitors, mayVisit } from './visits.js';

/** Which state may follow which. */
const NEXT: Record<VisitState, VisitState[]> = {
  requested: ['approved', 'refused', 'cancelled'],
  approved: ['visiting', 'cancelled'],
  visiting: ['returning'],
  returning: ['home'],
  home: [],
  cancelled: [],
  refused: [],
};

/** A visit that has not finished, one way or another. */
export const isOpen = (visit: Pick<Visit, 'state'>): boolean => NEXT[visit.state].length > 0;

export class VisitRuleError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** `visit` moved on to `to`, or a VisitRuleError when that is not a step it can take. */
export function advance(visit: Visit, to: VisitState, at: string, note?: string): Visit {
  if (!NEXT[visit.state].includes(to)) {
    throw new VisitRuleError(409, `A visit that is ${visit.state} cannot become ${to}.`);
  }
  return {
    ...visit,
    state: to,
    updatedAt: at,
    history: [...visit.history, { state: to, at, ...(note && { note }) }],
  };
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The latest a visit may last, from either team's limit, or undefined for none. */
export function visitDeadline(home: ProjectDefinition, host: ProjectDefinition, from: Date): string | undefined {
  const limits = [home.settings?.visits?.maxHours, host.settings?.visits?.maxHours].filter((h): h is number => !!h);
  if (limits.length === 0) return undefined;
  return new Date(from.getTime() + Math.min(...limits) * 3_600_000).toISOString();
}

/**
 * Why `agent` of `home` may not visit `host` for `reason` now, or null when it
 * may. `open` is every visit not yet finished.
 */
export function visitProblem(
  home: ProjectDefinition, host: ProjectDefinition, agentId: string, reason: VisitReason, open: Visit[],
): string | null {
  const agent = home.team.find((a) => a.instanceId === agentId);
  if (!agent) return `There is no agent ${agentId} on ${home.name}.`;
  if (agent.visit) return `${agent.name} is itself visiting ${home.name}, and cannot visit onwards.`;
  if (agent.away) return `${agent.name} is already away, visiting ${agent.away.host}.`;
  if (agent.enabled === false) return `${agent.name} is not running on ${home.name}.`;
  if (open.some((v) => v.agent.instanceId === agentId && same(v.home, home.id))) {
    return `${agent.name} has already asked to visit somewhere.`;
  }
  if (!reason.ticket?.trim()) return 'A visit needs a home ticket: it is the reason for going.';
  if (!reason.purpose?.trim() || !reason.expectedResult?.trim()) {
    return 'A visit needs a purpose and the result it will bring back.';
  }
  const homeTeam = { id: home.id, ...(home.settings?.visits && { visits: home.settings.visits }) };
  const hostTeam = { id: host.id, ...(host.settings?.visits && { visits: host.settings.visits }) };
  if (!hostsVisitors(host.settings?.visits) || !mayVisit(homeTeam, hostTeam)) {
    return `${home.name} and ${host.name} have not both agreed to this visit.`;
  }
  const hostServers = new Set((host.mcpServers ?? []).map((s) => s.name.toLowerCase()));
  const missing = (agent.needs?.tools?.required ?? []).filter((s) => !hostServers.has(s.toLowerCase()));
  if (missing.length) return `${host.name} does not have ${missing.join(', ')}, which ${agent.name} cannot work without.`;
  return null;
}

/**
 * The two teams once the agent has left home: home keeps its place, marked
 * away, and the host has it as a visitor, still belonging to home.
 */
export function leaveHome(home: ProjectDefinition, host: ProjectDefinition, visit: Visit): { home: DeployedAgent[]; host: DeployedAgent[] } {
  const agent = home.team.find((a) => a.instanceId === visit.agent.instanceId);
  if (!agent) throw new VisitRuleError(409, `${visit.agent.name} is no longer on ${home.name}.`);
  const visitor: DeployedAgent = { ...agent, home: home.id, visit: visit.id };
  delete visitor.away;
  return {
    home: home.team.map((a) => (a === agent ? { ...a, away: { visit: visit.id, host: host.id } } : a)),
    host: [...host.team.filter((a) => a.visit !== visit.id), visitor],
  };
}

/** The two teams once the agent is back: the host no longer has it, and home has it in its place. */
export function comeHome(home: ProjectDefinition, host: ProjectDefinition, visit: Visit): { home: DeployedAgent[]; host: DeployedAgent[] } {
  return {
    home: home.team.map((a) => {
      if (a.away?.visit !== visit.id) return a;
      const back = { ...a };
      delete back.away;
      return back;
    }),
    host: host.team.filter((a) => a.visit !== visit.id),
  };
}

// ── Permanent moves ──────────────────────────────────────────────────────────

/**
 * Why `agentId` may not move from `from` to `to` for good, or null when it
 * may. The new team must host agents from the old one; an agent away, on a
 * visit, or with a visit under way stays where it is until that is over.
 */
export function moveProblem(from: ProjectDefinition, to: ProjectDefinition, agentId: string, openVisits: Visit[]): string | null {
  const agent = from.team.find((a) => a.instanceId === agentId);
  if (!agent) return `There is no agent ${agentId} on ${from.name}.`;
  if (same(from.id, to.id)) return `${agent.name} is already on ${to.name}.`;
  if (agent.away || agent.visit || agent.move) return `${agent.name} is on a visit or a move already; wait until it is over.`;
  if (openVisits.some((v) => v.agent.instanceId === agentId)) return `${agent.name} has a visit under way; wait until it is over.`;
  const fromTeam = { id: from.id, visits: { visitTo: [to.id] } };
  const toTeam = { id: to.id, ...(to.settings?.visits && { visits: to.settings.visits }) };
  if (!mayVisit(fromTeam, toTeam)) return `${to.name} does not take agents from ${from.name}.`;
  if (to.team.some((a) => same(a.name, agent.name))) return `${to.name} already has someone called ${agent.name}.`;
  return null;
}

/** The two teams once the agent has moved: gone from `from`, on `to`, marked with the move until its runner has it. */
export function moveTeams(from: ProjectDefinition, to: ProjectDefinition, moveId: string, agentId: string): { from: DeployedAgent[]; to: DeployedAgent[] } {
  const agent = from.team.find((a) => a.instanceId === agentId);
  if (!agent) throw new VisitRuleError(409, `The agent is no longer on ${from.name}.`);
  const moved: DeployedAgent = { ...agent, move: moveId };
  delete moved.home;
  return { from: from.team.filter((a) => a !== agent), to: [...to.team, moved] };
}
