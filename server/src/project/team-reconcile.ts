/**
 * Bringing the live team into line with its project definition.
 *
 * The Project Designer edits the definition: members join, leave, and change
 * name, hats, model, identity or tools. The runner applies those edits to the
 * agents it is running, without restarting them, so their conversations and
 * work carry on. Only what the definition holds is compared; everything the
 * runner keeps for itself (threads, memory, costs) is left alone.
 */

import type { DeployedAgent, ProjectDefinition } from '../../../packages/contracts/src/types.js';
import type { HatType } from '../../../packages/core/src/hats/types.js';
import type { ProviderFactory, TeamOrchestrator } from '../orchestrator/orchestrator.js';
import { toDeployedAgent } from '../embodiment/agent-mapper.js';
import { assembleFromDefinition } from './team-assembler.js';
import { describeChanges } from './team-news.js';
import { log } from '../../../packages/core/src/logger.js';

export interface TeamChanges {
  /** Members the live team does not have yet. */
  added: DeployedAgent[];
  /** Live agents no longer on the team, or disabled, by name. */
  removed: string[];
  /** Live agents whose definition differs, by their live name. */
  changed: { from: DeployedAgent; to: DeployedAgent }[];
}

export const noChanges = (c: TeamChanges): boolean =>
  c.added.length === 0 && c.removed.length === 0 && c.changed.length === 0;

/** The live team as definition members, keeping the template links `previous` holds. */
export function liveTeam(orchestrator: TeamOrchestrator, previous: DeployedAgent[]): DeployedAgent[] {
  const byId = new Map(previous.map((a) => [a.instanceId, a]));
  return orchestrator.listAgents().map((agent) => toDeployedAgent(agent, byId.get(agent.id)));
}

/** A value with empty fields dropped and keys sorted, so equal settings compare equal. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = canonical((value as Record<string, unknown>)[key]);
      if (v === undefined || v === null || v === '') continue;
      if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) continue;
      out[key] = v;
    }
    return out;
  }
  return value;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/** The parts of a member the Designer edits and the runner can apply live. */
const SECTIONS = {
  name:     (a: DeployedAgent) => a.name,
  hats:     (a: DeployedAgent) => [...a.hats].sort(),
  model:    (a: DeployedAgent) => ({ provider: a.model.provider, model: a.model.model }),
  identity: (a: DeployedAgent) => a.identity,
  limits:   (a: DeployedAgent) => ({ maxContextTokens: a.limits?.maxContextTokens, maxCostPerHour: a.limits?.maxCostPerHour }),
  tools:    (a: DeployedAgent) => ({
    enabledMcpServers: a.tools?.enabledMcpServers,
    disabledPersonalMcpServers: a.tools?.disabledPersonalMcpServers,
    upfrontTools: a.tools?.upfrontTools,
  }),
};
type Section = keyof typeof SECTIONS;

/** Which parts of a member differ between `from` and `to`. */
export function changedSections(from: DeployedAgent, to: DeployedAgent): Section[] {
  return (Object.keys(SECTIONS) as Section[]).filter((s) => !same(SECTIONS[s](from), SECTIONS[s](to)));
}

/**
 * What it takes to turn `live` into `wanted`. Members are matched by instance
 * id, then by name: the team assumes names are unique, and a member that
 * arrived under a second id is still the same agent.
 */
export function diffTeam(wanted: DeployedAgent[], live: DeployedAgent[]): TeamChanges {
  const unmatched = new Map(live.map((a) => [a.instanceId, a]));
  const changes: TeamChanges = { added: [], removed: [], changed: [] };

  for (const member of wanted.filter((a) => a.enabled !== false)) {
    const match = unmatched.get(member.instanceId)
      ?? [...unmatched.values()].find((a) => a.name.toLowerCase() === member.name.toLowerCase());
    if (!match) { changes.added.push(member); continue; }
    unmatched.delete(match.instanceId);
    if (changedSections(match, member).length > 0) changes.changed.push({ from: match, to: member });
  }
  changes.removed = [...unmatched.values()].map((a) => a.name);
  return changes;
}

export interface ApplyDeps {
  providerFactory: ProviderFactory;
  /** Takes an agent off the team. The dashboard's own removal, once it is running. */
  retire: (name: string) => Promise<void>;
  /** Told what changed, as news for the team. */
  announce?: (news: string[]) => void | Promise<void>;
}

/** Apply one member's edits to its live agent. */
async function updateAgent(orch: TeamOrchestrator, from: DeployedAgent, to: DeployedAgent, providerFactory: ProviderFactory): Promise<void> {
  const sections = changedSections(from, to);
  let name = from.name;
  if (sections.includes('name')) { await orch.renameAgent(name, to.name); name = to.name; }
  if (sections.includes('hats')) orch.changeAgentHat(name, to.hats as unknown as HatType[]);
  if (sections.includes('model')) orch.updateAgentConfig(name, providerFactory(to.model.provider), to.model.model);
  if (sections.includes('identity')) {
    const id = to.identity;
    orch.updateAgentSpecialisation(name, id.specialisation);
    orch.updateAgentIdentity(name, id.visualDescription, id.backstory);
    orch.updateAgentAvatar(name, id.avatar);
    orch.updateAgentBackground(name, id.background);
    orch.updateAgentVoice(name, id.voice, id.speakerName);
    orch.updateAgentEmail(name, id.email);
  }
  if (sections.includes('limits')) {
    orch.updateAgentMaxContextTokens(name, to.limits?.maxContextTokens);
    orch.updateAgentMaxCostPerHour(name, to.limits?.maxCostPerHour);
  }
  if (sections.includes('tools')) {
    orch.updateAgentMcpServers(name, to.tools?.enabledMcpServers);
    orch.updateAgentDisabledPersonalMcp(name, to.tools?.disabledPersonalMcpServers);
    orch.updateAgentUpfrontTools(name, to.tools?.upfrontTools);
  }
}

/**
 * Bring the live team into line with `definition`, and its goal and human
 * name. One member failing to apply is logged and the rest carry on.
 * Returns what changed.
 */
export async function applyDefinition(
  orch: TeamOrchestrator,
  definition: ProjectDefinition,
  previous: DeployedAgent[],
  deps: ApplyDeps,
): Promise<TeamChanges> {
  const changes = diffTeam(definition.team, liveTeam(orch, previous));
  // Read before anything is applied: embodying new members sets the goal too.
  const newGoal = definition.goal && definition.goal !== (orch.getProjectGoal() ?? '') ? definition.goal : undefined;

  for (const name of changes.removed) {
    await deps.retire(name).catch((err: Error) => log.warn(`[ProjectSync] Could not remove "${name}": ${err.message}`));
  }
  for (const { from, to } of changes.changed) {
    await updateAgent(orch, from, to, deps.providerFactory)
      .catch((err: Error) => log.warn(`[ProjectSync] Could not update "${from.name}": ${err.message}`));
  }
  if (changes.added.length > 0) {
    assembleFromDefinition(orch, { ...definition, team: changes.added }, deps.providerFactory);
  }
  if (newGoal) orch.setProjectGoal(newGoal);
  if (definition.humanName && definition.humanName !== orch.getHumanName()) orch.setHumanName(definition.humanName);

  if (!noChanges(changes)) {
    log.info(`[ProjectSync] Applied the project's team: ${changes.added.length} joined, `
      + `${changes.removed.length} left, ${changes.changed.length} changed`);
  }
  const news = describeChanges(changes, newGoal);
  if (news.length > 0) await deps.announce?.(news);
  return changes;
}
