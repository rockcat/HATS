// ── Finding a team to visit ──────────────────────────────────────────────────
//
// An agent describes what it needs; this returns the few teams it could
// actually visit that best match. Teams it cannot reach are never returned:
// that keeps the answer short, and keeps a prompt injection from steering
// an agent towards a team it has no business with. See docs/team-visits.md.

import { mayVisit } from '@hats/contracts/visits';
import type { TeamCard } from '@hats/contracts/types';

/** A card as an agent sees it: who may visit whom is the manager's business, not the agent's. */
export type PublicCard = Omit<TeamCard, 'visits'>;

export const DEFAULT_LIMIT = 3;

const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'about', 'need', 'needs', 'want']);

/** The words in `text` worth matching on. */
export function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? []).filter((w) => !STOP_WORDS.has(w));
}

/** How well `card` matches `intent`: a tag counts most, then tools, then everything else. */
export function score(card: TeamCard, intent: string[]): number {
  if (intent.length === 0) return 0;
  const tags = new Set(card.tags.flatMap(words));
  const tools = new Set(card.tools.flatMap((t) => words(`${t.name} ${t.description ?? ''}`)));
  const rest = new Set(words([
    card.name, card.summary, card.models.join(' '),
    ...card.members.map((m) => `${m.specialisation ?? ''} ${m.hats.join(' ')}`),
  ].join(' ')));
  return intent.reduce((sum, w) => sum + (tags.has(w) ? 3 : 0) + (tools.has(w) ? 2 : 0) + (rest.has(w) ? 1 : 0), 0);
}

const publicCard = ({ visits: _visits, ...card }: TeamCard): PublicCard => card;

/**
 * The teams an agent of team `from` could visit, best match for `intent`
 * first. Nothing when `from` has no card, since its policy is unknown.
 */
export function discoverTeams(cards: TeamCard[], from: string, intent: string, limit = DEFAULT_LIMIT): PublicCard[] {
  const home = cards.find((c) => c.team.toLowerCase() === from.toLowerCase());
  if (!home) return [];
  const wanted = words(intent);
  return cards
    .filter((c) => c.hosting && mayVisit({ id: home.team, visits: home.visits }, { id: c.team, visits: c.visits }))
    .map((card) => ({ card, score: score(card, wanted) }))
    .sort((a, b) => b.score - a.score || a.card.name.localeCompare(b.card.name))
    .slice(0, Math.max(1, limit))
    .map(({ card }) => publicCard(card));
}
