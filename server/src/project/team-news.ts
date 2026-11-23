/**
 * Team changes as news an agent can read: who joined, who left, and what
 * changed about a member that the rest of the team works with. Changes no
 * teammate needs to know about (an avatar, a voice, cost limits, tools) are
 * left out.
 */

import type { DeployedAgent } from '../../../packages/contracts/src/types.js';
import { changedSections, type TeamChanges } from './team-reconcile.js';

const list = (items: string[]): string =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

const hats = (a: DeployedAgent): string =>
  `the ${list(a.hats)} hat${a.hats.length === 1 ? '' : 's'}`;

function joined(a: DeployedAgent): string {
  const what = a.identity.specialisation ? `${a.identity.specialisation}, wearing ${hats(a)}` : `wearing ${hats(a)}`;
  return `${a.name} joined the team (${what}).`;
}

function changed(from: DeployedAgent, to: DeployedAgent): string[] {
  const sections = changedSections(from, to);
  const news: string[] = [];
  if (sections.includes('name')) news.push(`${from.name} is now called ${to.name}.`);
  if (sections.includes('identity') && (from.identity.specialisation ?? '') !== (to.identity.specialisation ?? '')) {
    news.push(to.identity.specialisation
      ? `${to.name} now specialises in ${to.identity.specialisation}.`
      : `${to.name} no longer has a specialisation.`);
  }
  if (sections.includes('hats')) news.push(`${to.name} now wears ${hats(to)}.`);
  if (sections.includes('model')) news.push(`${to.name} now runs on ${to.model.provider} ${to.model.model}.`);
  return news;
}

/** What to tell the team about `changes`, and about a new goal if there is one. */
export function describeChanges(changes: TeamChanges, newGoal?: string): string[] {
  return [
    ...changes.added.map(joined),
    ...changes.removed.map((name) => `${name} left the team.`),
    ...changes.leaving.map((a) => `${a.name} has gone to visit ${a.away?.host ?? 'another team'}, and will be back.`),
    ...changes.returning.map((a) => `${a.name} is back from a visit.`),
    ...changes.arriving.map((a) => `${a.name} is visiting from ${a.home ?? 'another team'}, to help with one piece of work.`),
    ...changes.movingIn.map((a) => `${a.name} has moved to this team for good.`),
    ...changes.departing.map((a) =>`${a.name} has gone home to ${a.home ?? 'their team'}.`),
    ...changes.changed.flatMap(({ from, to }) => changed(from, to)),
    ...(newGoal ? [`The project goal is now: ${newGoal}`] : []),
  ];
}
