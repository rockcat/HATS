/**
 * Home teams and the visit policy: who may visit whom.
 *
 * See docs/team-visits.md in the HATS repository. Every agent belongs to a
 * home team, and may visit another team only where both have agreed: the
 * home lists the host in `visitTo`, and the host lists the home in
 * `hostFrom`. Nothing is allowed by default.
 */

import type { DeployedAgent, VisitPolicy } from './types.js';

/** Any team in the installation. Has to be chosen on purpose. */
export const ANY_TEAM = '*';

/** The project an agent belongs to: its own `home`, or the project holding it. */
export function homeOf(agent: Pick<DeployedAgent, 'home'>, holdingProject: string): string {
  return agent.home ?? holdingProject;
}

const lists = (list: string[] | undefined, team: string): boolean =>
  (list ?? []).some((entry) => entry === ANY_TEAM || entry.toLowerCase() === team.toLowerCase());

/** Whether this team hosts any visitors at all. */
export function hostsVisitors(policy: VisitPolicy | undefined): boolean {
  return (policy?.hostFrom ?? []).length > 0;
}

/**
 * Whether an agent from `home` may visit `host`: both have to agree, and a
 * team never visits itself.
 */
export function mayVisit(
  home: { id: string; visits?: VisitPolicy },
  host: { id: string; visits?: VisitPolicy },
): boolean {
  if (home.id.toLowerCase() === host.id.toLowerCase()) return false;
  return lists(home.visits?.visitTo, host.id) && lists(host.visits?.hostFrom, home.id);
}
