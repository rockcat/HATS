/**
 * This team's card, for other teams finding it: see docs/team-visits.md in
 * the HATS repository. Built from the project definition and the agents
 * actually running, and sent with every report-in to the runner manager.
 */

import { KNOWN_PROVIDERS } from '../../../packages/core/src/providers.js';
import type { ProjectDefinition, TeamCard } from '../../../packages/contracts/src/types.js';
import { hostsVisitors } from '../../../packages/contracts/src/visits.js';

/** A running agent, as much of one as a card shows. */
export interface CardMember {
  name: string;
  hatType: readonly string[];
  config: { identity: { specialisation?: string } };
}

export interface TeamCardInput {
  definition: Pick<ProjectDefinition, 'id' | 'name' | 'goal' | 'settings' | 'mcpServers'>;
  members: CardMember[];
  /** A team MCP server's one-line description, from the catalogue. */
  describeServer?: (name: string) => string | undefined;
  /** Environment to read model keys from. */
  env?: Record<string, string | undefined>;
  dashboard?: string;
}

const SUMMARY_MAX = 400;

/**
 * The model providers with a key set here. Local servers (Ollama, LM Studio)
 * are left out: their addresses are set in every container whether or not
 * anything answers there, so listing them would claim every team runs them.
 */
export function configuredProviders(env: Record<string, string | undefined> = process.env): string[] {
  return KNOWN_PROVIDERS.filter((p) => p.envKey && env[p.envKey]).map((p) => p.id);
}

export function buildTeamCard(input: TeamCardInput): TeamCard {
  const { definition } = input;
  const settings = definition.settings ?? {};
  const visits = settings.visits ?? {};
  const summary = (settings.summary || definition.goal || '').trim().slice(0, SUMMARY_MAX);

  return {
    team: definition.id,
    name: definition.name,
    summary,
    tags: settings.tags ?? [],
    members: input.members.map((m) => ({
      name: m.name,
      hats: [...m.hatType],
      ...(m.config.identity.specialisation && { specialisation: m.config.identity.specialisation }),
    })),
    tools: (definition.mcpServers ?? []).map((s) => {
      const description = input.describeServer?.(s.name);
      return { name: s.name, ...(description && { description }) };
    }),
    models: configuredProviders(input.env),
    hosting: hostsVisitors(visits),
    approval: visits.approval ?? 'admin',
    visits: { visitTo: visits.visitTo ?? [], hostFrom: visits.hostFrom ?? [] },
    ...(input.dashboard && { dashboard: input.dashboard }),
  };
}
