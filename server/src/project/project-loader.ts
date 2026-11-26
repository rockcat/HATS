/**
 * Building the running team for one project.
 *
 * Used at startup and on every project switch. The definition is read for
 * the project being opened, each time. It used to be the definition the
 * runner started with, captured once: every project opened afterwards was
 * built from — or topped up with — the startup project's agents, which is how
 * one agent turned up in other projects and then multiplied on each switch.
 */

import { existsSync } from 'fs';
import * as path from 'path';
import { TeamOrchestrator } from '../orchestrator/orchestrator.js';
import type { ProviderFactory } from '../orchestrator/orchestrator.js';
import type { ProjectLoader } from '../api/api-server.js';
import type { AgentDefinitionStore } from '../api/agent-store.js';
import type { ProjectDefinition } from '../../../packages/contracts/src/types.js';
import type { ProjectServerClient } from '../../../packages/clients/src/project-server-client.js';
import { assembleDefaultTeam, assembleFromDefinition, attachDefinitionMcpServers, savedServerForHere } from './team-assembler.js';

export interface ProjectSource {
  /** Null when the project is local, or the Project Server does not know it. */
  definition: ProjectDefinition | null;
  client: ProjectServerClient | null;
}

export interface LoadedProject extends ProjectSource {
  orchestrator: TeamOrchestrator;
}

export interface ProjectLoaderDeps {
  agentStore: AgentDefinitionStore;
  providerFactory: ProviderFactory;
  defaultModel: string;
  /** The definition of the project with this id, read now. */
  sourceFor(projectId: string): Promise<ProjectSource>;
  /** Told about each project once its team is built — to point ProjectSync at it. */
  onLoaded?(loaded: LoadedProject): void | Promise<void>;
}

/**
 * Agents a definition has that the running team does not — deployed in the
 * Designer since the snapshot was written. Matched by instance id and by
 * name: the team assumes names are unique, and an agent that arrived under a
 * second id is still the same agent.
 */
export function deployedSince(definition: ProjectDefinition, running: { id: string; name: string }[]): ProjectDefinition['team'] {
  const ids = new Set(running.map(a => a.id));
  const names = new Set(running.map(a => a.name.toLowerCase()));
  return definition.team.filter(a => a.enabled !== false && !ids.has(a.instanceId) && !names.has(a.name.toLowerCase()));
}

export function makeProjectLoader(deps: ProjectLoaderDeps): ProjectLoader {
  const { agentStore, providerFactory } = deps;

  // The board file is opened by the runner's own KanbanStore, not by anything here.
  return async (projectDir: string, _kanbanFile: string, stateFile: string) => {
    const source = await deps.sourceFor(path.basename(projectDir));
    const { definition } = source;

    const orchestrator = new TeamOrchestrator({
      storePath:    path.join(projectDir, 'team-events.jsonl'),
      projectsRoot: projectDir,
      humanName:    definition?.humanName ?? 'Boss',
    });
    orchestrator.setAgentStore(agentStore);
    // Before restoring anything. The API server sets this too, but only once
    // it starts — after state has been loaded and active tasks resumed. Until
    // then the orchestrator has no project, so it has no board, so every
    // ticket looks absent and a task whose ticket was closed gets resumed
    // anyway. That is how TKT-009 kept coming back.
    orchestrator.setProjectDir(projectDir);
    await orchestrator.init();
    await orchestrator.initMeetingStore(path.join(projectDir, 'meetings.json'));
    await orchestrator.initAgendaStore(path.join(projectDir, 'agent-agenda.json'));

    if (existsSync(stateFile)) {
      console.log(`[Team] Restoring conversation state from ${stateFile}`);
      const mcpDefs = await orchestrator.loadState(stateFile, providerFactory);
      for (const saved of mcpDefs) {
        const def = savedServerForHere(saved);
        if (!def) continue;

        // One server failing must not stop the runner starting. An expired
        // credential on an optional MCP — a Google token nobody has refreshed
        // for a week — would otherwise reject here, go unhandled, and take the
        // whole process down before it ever listens.
        await orchestrator.addMCPServer(def).catch((err: Error) =>
          console.log(`[Team] MCP server "${def.name}" failed to start: ${err.message}`));
      }

      // The definition still owns goal, human name, and any agents added in the
      // Designer since the snapshot was written.
      if (definition) {
        if (definition.goal) orchestrator.setProjectGoal(definition.goal);
        orchestrator.setHumanName(definition.humanName);
        const added = deployedSince(definition, orchestrator.listAgents());
        if (added.length > 0) {
          console.log(`[Team] Adding ${added.length} agent(s) deployed since the last run`);
          assembleFromDefinition(orchestrator, { ...definition, team: added }, providerFactory);
        }
      }

      const { resumed } = await orchestrator.resumeActiveTasks();
      if (resumed.length > 0) console.log(`[Team] Resumed ${resumed.length} active task(s)`);
    } else if (definition && definition.team.length > 0) {
      assembleFromDefinition(orchestrator, definition, providerFactory);
      await attachDefinitionMcpServers(orchestrator, definition);
    } else {
      console.log(`[Team] No team defined for ${projectDir} — assembling a default team.`);
      const names = assembleDefaultTeam(orchestrator, providerFactory, 'anthropic', deps.defaultModel);
      console.log(`[Team] Team assembled: ${names.join(' · ')}`);
    }

    // Before pruning: an agent away on a visit is still on the team, and its
    // scheduled actions wait for it rather than being deleted.
    orchestrator.markAway((definition?.team ?? []).filter((a) => a.away).map((a) => a.name));
    await orchestrator.pruneAgenda();
    await deps.onLoaded?.({ orchestrator, ...source });
    return orchestrator;
  };
}
