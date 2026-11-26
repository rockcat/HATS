// ── A running agent as it is written down, and back ──────────────────────────
//
// A team save, a saved agent and a duplicate all need the same two steps: an
// agent's settings and threads as plain data, and an agent config built from
// that data again. Kept here so the three cannot drift apart — a setting the
// save learned about and the duplicate did not would quietly be lost.

import type { IAgent } from '../agent/iagent.js';
import type { AgendaStore } from '../api/agenda-store.js';
import type { AgentConfig, AgentMessage } from '../agent/types.js';
import type { AIProvider } from '../providers/types.js';
import type { AgentDefinition, HistoryEntry } from '../store/team-snapshot.js';

export function serializeMessages(msgs: AgentMessage[]): HistoryEntry[] {
  return msgs.map((m) => ({
    role: m.role,
    content: m.content,
    timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : String(m.timestamp),
    toolCalls: m.toolCalls,
    toolCallId: m.toolCallId,
    toolName: m.toolName,
  }));
}

/** Every thread the agent has, keyed by thread. */
export function serializeThreads(agent: IAgent): Record<string, HistoryEntry[]> {
  const out: Record<string, HistoryEntry[]> = {};
  for (const [key, msgs] of Object.entries(agent.getAllThreadHistories())) out[key] = serializeMessages(msgs);
  return out;
}

/** The scheduled actions on an agent's agenda. */
export function assignedActionIds(agenda: Pick<AgendaStore, 'list'> | null, agentName: string): string[] {
  return (agenda?.list(agentName) ?? []).flatMap((e) => (e.actionId ? [e.actionId] : []));
}

/**
 * The agent's settings as saved. Credentials are left out unless asked for:
 * they belong in this machine's secrets file, not in anything that travels.
 */
export function definitionOf(
  agent: IAgent,
  scheduledActionIds: string[],
  { withCredentials = false }: { withCredentials?: boolean } = {},
): AgentDefinition {
  const c = agent.config;
  return {
    id:                         agent.id,
    ...(c.templateId && { templateId: c.templateId }),
    identity:                   c.identity,
    hatType:                    c.hatType,
    model:                      c.model,
    providerName:               c.provider.name,
    teamContext:                c.teamContext,
    enabledMcpServers:          c.enabledMcpServers,
    ...(withCredentials && { personalMcpCredentials: c.personalMcpCredentials }),
    disabledPersonalMcpServers: c.disabledPersonalMcpServers,
    upfrontTools:               c.upfrontTools,
    scheduledActionIds,
    // Left out, every save stored the agent without its limits, and the
    // next time it was built — a project switch, a restore — it had none.
    maxContextTokens:           c.maxContextTokens,
    maxCostPerHour:             c.maxCostPerHour,
    needs:                      c.needs,
    instructions:               c.instructions,
    promptMode:                 c.promptMode,
    externalEndpoint:           c.externalEndpoint,
  };
}

/** An agent config built from a saved definition, with the provider it names already made. */
export function configFrom(
  def: AgentDefinition,
  provider: AIProvider,
  personalMcpCredentials: AgentDefinition['personalMcpCredentials'],
): AgentConfig {
  return {
    id:                         def.id,
    ...(def.templateId && { templateId: def.templateId }),
    identity:                   def.identity,
    hatType:                    def.hatType,
    provider,
    model:                      def.model,
    teamContext:                def.teamContext,
    enabledMcpServers:          def.enabledMcpServers,
    personalMcpCredentials,
    disabledPersonalMcpServers: def.disabledPersonalMcpServers,
    upfrontTools:               def.upfrontTools,
    maxContextTokens:           def.maxContextTokens,
    maxCostPerHour:             def.maxCostPerHour,
    needs:                      def.needs,
    instructions:               def.instructions,
    promptMode:                 def.promptMode,
    externalEndpoint:           def.externalEndpoint,
  };
}
