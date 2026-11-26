/**
 * Capturing an agent from a running team, and restoring one into it: shared
 * by the dashboard's duplicate, export and send, and by visits.
 */

import * as path from 'path';
import type { IAgent } from '../agent/iagent.js';
import type { TeamOrchestrator } from '../orchestrator/orchestrator.js';
import type { ScheduledActionStore } from '../api/scheduled-action-store.js';
import { assignScheduledActions } from '../api/project-agents.js';
import { assignedActionIds } from '../orchestrator/agent-definition.js';
import { makeProvider } from '../api/providers.js';
import { AnthropicProvider } from '../providers/anthropic.js';
import { EXTERNAL_PROVIDER } from '../agent/external-agent.js';
import { captureAgent, type AgentTarget } from './agent-transfer.js';
import type { AgentBundle } from './agent-bundle.js';

export interface AgentIo {
  orchestrator: TeamOrchestrator;
  actionStore: ScheduledActionStore | null;
  /** The data directory, which holds avatars/. */
  dataRoot: string;
}

/** Everything about `agent`; its logins only when asked. */
export function captureFrom(io: AgentIo, agent: IAgent, includeCredentials: boolean): Promise<AgentBundle> {
  const orch = io.orchestrator;
  return captureAgent({
    agent,
    scheduledActionIds: assignedActionIds(orch.getAgendaStore(), agent.name),
    agentDir: orch.agentDir(agent.name),
    dataRoot: io.dataRoot,
    actions: { get: (id) => io.actionStore?.get(id) },
  }, { includeCredentials });
}

/** Where a restored agent goes: the team `io` runs. */
export function targetFor(io: AgentIo): AgentTarget {
  const orch = io.orchestrator;
  const projectDir = orch.getProjectDir();
  return {
    hasAgentNamed: (n) => orch.listAgents().some((a) => a.name.toLowerCase() === n.toLowerCase()),
    providerFor: (def) => (def.externalEndpoint || def.providerName === 'external'
      ? EXTERNAL_PROVIDER
      : makeProvider(def.providerName) ?? new AnthropicProvider()),
    register: (config) => orch.registerAgent(config),
    agentDirFor: (id) => (projectDir ? path.join(projectDir, 'agents', id) : undefined),
    dataRoot: io.dataRoot,
    actions: {
      addIfMissing: async (def) => io.actionStore?.addIfMissing(def) ?? false,
    },
    assignActions: (agentName, ids) => assignScheduledActions(orch.getAgendaStore(), io.actionStore, agentName, ids),
  };
}
