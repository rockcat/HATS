/**
 * Turning a project definition into a running team.
 *
 * This is the seam where the Project Server's declarative team roster becomes
 * live agents in the orchestrator.
 */

import { builtinServerCommand } from '../mcp/builtin-server.js';
import type { TeamOrchestrator } from '../orchestrator/orchestrator.js';
import type { ProviderFactory } from '../orchestrator/orchestrator.js';
import type { ProjectDefinition } from '../../../packages/contracts/src/types.js';
import type { MCPServerDef } from '../mcp/mcp-client.js';
import { HatType } from '../hats/types.js';
import { getRandomPersona } from '../hats/personas.js';
import { toAgentConfig } from '../embodiment/agent-mapper.js';
import { log } from '../util/logger.js';

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

/** Attach the shared MCP servers a definition asks for, repointing kanban at this project's board. */
export async function attachDefinitionMcpServers(
  orchestrator: TeamOrchestrator,
  definition: ProjectDefinition,
  kanbanFile: string,
): Promise<void> {
  for (const server of definition.mcpServers ?? []) {
    const def = { name: server.name, config: { ...server.config } } as MCPServerDef;
    if (def.name === 'kanban' && def.config.transport === 'stdio') {
      const args = (def.config.args ?? []).filter((a: string) => !a.endsWith('.json'));
      def.config.args = [...args, kanbanFile];
    }
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

/** The default kanban MCP server for a brand new local project. */
export function defaultKanbanServer(kanbanFile: string): MCPServerDef {
  // Resolved the same way the catalogue entry is, so there is one answer to
  // "how does the kanban server start" rather than two that can drift apart —
  // which is exactly how the catalogue came to name a path no build writes.
  const { command, args } = builtinServerCommand('mcp/kanban/server');
  return {
    name: 'kanban',
    config: { transport: 'stdio', command, args: [...args, kanbanFile] },
  } as MCPServerDef;
}
