/**
 * When a tool is not there.
 *
 * An agent can depend on tools its team does not have: a server never set up
 * for this team, one that failed to start, or (once visits exist) one its home
 * team has and its host does not. Rather than failing the turn, the agent is
 * told plainly, and told what to do instead. See docs/team-visits.md in the
 * HATS repository.
 */

import type { AgentNeeds } from '../../../packages/contracts/src/types.js';

const MCP_TOOL = /^mcp__(.+?)__(.+)$/;

/** The MCP servers a set of tool names comes from: `mcp__<server>__<tool>`. */
export function serversIn(toolNames: Iterable<string>): Set<string> {
  const servers = new Set<string>();
  for (const name of toolNames) {
    const match = MCP_TOOL.exec(name);
    if (match) servers.add(match[1]!.toLowerCase());
  }
  return servers;
}

/** The required and preferred servers in `needs` that `reachable` lacks. */
export function unmetNeeds(needs: AgentNeeds | undefined, reachable: Set<string>): { required: string[]; preferred: string[] } {
  const missing = (list: string[] | undefined) => (list ?? []).filter((s) => !reachable.has(s.toLowerCase()));
  return { required: missing(needs?.tools?.required), preferred: missing(needs?.tools?.preferred) };
}

const list = (items: string[]): string =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

const instead = (canDiscoverTeams: boolean): string =>
  'Carry on with what you can do without it, and say what you could not do when you report back'
  + (canDiscoverTeams ? '; discover_teams can find a team that has it.' : '.');

/** What an agent is told when tools it cannot work without are not available to it. */
export function needsNotice(missingRequired: string[], canDiscoverTeams: boolean): string {
  const s = missingRequired.length === 1;
  return `You need ${list(missingRequired)}, which ${s ? 'is' : 'are'} not available to you on this team right now. `
    + `${instead(canDiscoverTeams)} The human has been told.`;
}

/** What a call to a tool that is not there returns, instead of an error that derails the turn. */
export function missingToolMessage(name: string, canDiscoverTeams: boolean): string {
  const match = MCP_TOOL.exec(name);
  const what = match
    ? `The ${match[1]} tools are not available to you on this team, so ${match[2]} could not run.`
    : `There is no tool called ${name} here.`;
  return `${what} ${instead(canDiscoverTeams)}`;
}
