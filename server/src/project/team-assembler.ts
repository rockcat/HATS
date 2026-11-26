/**
 * Turning a project definition into a running team.
 *
 * This is the seam where the Project Server's declarative team roster becomes
 * live agents in the orchestrator.
 */

import { builtinServerCommand, repointBuiltinServer } from '../../../packages/core/src/mcp/builtin-server.js';
import type { TeamOrchestrator } from '../orchestrator/orchestrator.js';
import type { ProviderFactory } from '../orchestrator/orchestrator.js';
import type { ProjectDefinition } from '../../../packages/contracts/src/types.js';
import type { MCPServerDef } from '../mcp/mcp-client.js';
import { HatType } from '../../../packages/core/src/hats/types.js';
import { getRandomPersona } from '../../../packages/core/src/hats/personas.js';
import { toAgentConfig } from '../embodiment/agent-mapper.js';
import { log } from '../../../packages/core/src/logger.js';
import { forThisMachine } from '../../../packages/core/src/mcp/saved-config.js';

/**
 * Register every enabled agent from a project definition.
 *
 * Per-agent MCP credentials are not part of the definition — they stay on the
 * runner — so they are pulled from the agent store and re-attached here.
 */
export function assembleFromDefinition(
  orchestrator: TeamOrchestrator,
  definition: ProjectDefinition,
  providerFactory: ProviderFactory,
): number {
  const store = orchestrator.getAgentStore();
  const enabled = definition.team.filter((agent) => agent.enabled !== false);
  for (const deployed of enabled) {
    try {
      const secrets = store?.secretsFor?.(deployed.instanceId, deployed.templateId) ?? {};
      orchestrator.registerAgent(toAgentConfig(deployed, providerFactory, secrets));
    } catch (err) {
      log.warn(`[Team] Could not embody "${deployed.name}": ${(err as Error).message}`);
    }
  }
  if (definition.goal) orchestrator.setProjectGoal(definition.goal);
  orchestrator.setHumanName(definition.humanName);
  log.info(`[Team] Embodied ${enabled.length} agent(s) from project "${definition.name}"`);
  return enabled.length;
}

/**
 * A saved shared server, made to run here. It carries whatever was right when
 * it was written — the launcher, our own servers' paths, the keys — and any
 * of those may have changed or come from another machine.
 *
 * Null for a server that is now part of the runner: projects saved while the
 * board ran as its own server still list it, and its file no longer exists.
 */
export function savedServerForHere(saved: MCPServerDef): MCPServerDef | null {
  if (PART_OF_THE_RUNNER.has(saved.name)) return null;
  const config = forThisMachine(saved.config);
  const builtinServer = repointBuiltinServer(saved.name, config);
  return { ...saved, config: builtinServer ? { ...config, ...builtinServer } as MCPServerDef['config'] : config };
}

const PART_OF_THE_RUNNER = new Set(['kanban']);

/** Attach the shared MCP servers a definition asks for. */
export async function attachDefinitionMcpServers(
  orchestrator: TeamOrchestrator,
  definition: ProjectDefinition,
): Promise<void> {
  for (const server of definition.mcpServers ?? []) {
    const def = savedServerForHere({ name: server.name, config: server.config } as MCPServerDef);
    if (!def) continue;
    await orchestrator.addMCPServer(def).catch((err: Error) =>
      log.warn(`[Team] MCP server "${def.name}" failed to start: ${err.message}`));
  }
}

/**
 * The legacy bootstrap: a random blue-hat lead plus three other hats.
 * Used only when there is no project definition to work from.
 */
export function assembleDefaultTeam(
  orchestrator: TeamOrchestrator,
  providerFactory: ProviderFactory,
  providerName: string,
  model: string,
): string[] {
  const provider = providerFactory(providerName);
  const blueIdentity = getRandomPersona(HatType.Blue);
  orchestrator.registerAgent({ identity: blueIdentity, hatType: [HatType.Blue], provider, model });

  const pool = [HatType.White, HatType.Black, HatType.Yellow, HatType.Green, HatType.Red]
    .map((hat) => ({ identity: getRandomPersona(hat), hatType: [hat] }));

  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j] as typeof pool[0], pool[i] as typeof pool[0]];
  }

  const selected = pool.slice(0, 3);
  for (const agent of selected) orchestrator.registerAgent({ ...agent, provider, model });

  return [blueIdentity.name, ...selected.map((a) => a.identity.name)];
}

