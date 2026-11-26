/**
 * Asking the runner manager which teams this team's agents could visit, and
 * putting the answer in words an agent reads. The manager does the filtering
 * and ranking: a team this one may not visit is never returned.
 */

import type { ProjectDefinition, TeamCard } from '../../../packages/contracts/src/types.js';
import { runnerToken, runnerTokenHeaders } from '../../../packages/service-kit/src/runner-token.js';

/** A card as an agent sees it. */
export type VisibleCard = Omit<TeamCard, 'visits'>;

export interface TeamDirectoryOptions {
  managerUrl: string;
  /** This runner's project, read at each call: a runner that is not locked can switch. */
  team: () => string;
  /** This project's definition, for its visit policy; absent outside the Project Server. */
  definition: () => Pick<ProjectDefinition, 'settings'> | undefined;
  fetchImpl?: typeof fetch;
}

export class TeamDirectory {
  constructor(private readonly o: TeamDirectoryOptions) {}

  /** Whether this team's agents may visit any team at all, so the tool is worth offering. */
  available(): boolean {
    return (this.o.definition()?.settings?.visits?.visitTo ?? []).length > 0;
  }

  async discover(intent: string): Promise<VisibleCard[]> {
    const query = new URLSearchParams({ from: this.o.team(), intent });
    const res = await (this.o.fetchImpl ?? fetch)(
      `${this.o.managerUrl.replace(/\/$/, '')}/api/v1/teams?${query}`,
      { signal: AbortSignal.timeout(5_000), headers: runnerTokenHeaders(runnerToken()) },
    );
    if (!res.ok) throw new Error(`the runner manager answered ${res.status}`);
    return ((await res.json()) as { teams: VisibleCard[] }).teams;
  }
}

function describe(card: VisibleCard, n: number): string {
  const lines = [`${n}. ${card.name} (${card.team})${card.summary ? `: ${card.summary}` : ''}`];
  if (card.tags.length) lines.push(`   Works on: ${card.tags.join(', ')}`);
  if (card.tools.length) {
    lines.push(`   Tools: ${card.tools.map((t) => (t.description ? `${t.name} (${t.description})` : t.name)).join('; ')}`);
  }
  if (card.members.length) {
    lines.push(`   Members: ${card.members.map((m) => (m.specialisation ? `${m.name}, ${m.specialisation}` : m.name)).join('; ')}`);
  }
  lines.push(card.approval === 'auto'
    ? '   Visits: go ahead once asked for.'
    : '   Visits: wait for one of its admins to approve.');
  return lines.join('\n');
}

/** The teams found, as an agent reads them. */
export function formatTeams(cards: VisibleCard[]): string {
  if (cards.length === 0) {
    return 'No team you could visit matches that. Either no team offers it, '
      + 'or your team and theirs have not agreed to visits. Ask the human if it matters.';
  }
  return [
    'Teams you could visit, best match first:',
    '',
    cards.map((c, i) => describe(c, i + 1)).join('\n\n'),
    '',
    'To use what one of these teams offers, ask to visit it with request_visit, for one of your '
      + 'tickets, saying what you will do there and what you will bring back.',
  ].join('\n');
}
