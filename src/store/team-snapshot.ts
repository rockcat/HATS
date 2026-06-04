import { AgentIdentity } from '../agent/types.js';
import { HatType } from '../hats/types.js';
import { MCPServerDef } from '../mcp/mcp-client.js';
import { Task, Meeting } from '../orchestrator/types.js';

export const SNAPSHOT_VERSION = 2;

export interface McpToolCallSpec {
  serverName: string;
  toolName: string;                    // full namespaced: mcp__<server>__<tool>
  args: Record<string, unknown>;
  condition: string;                   // JS expression; `result` (string) is in scope
  messageTemplate: string;            // sent to agent when condition passes; ${result} interpolated
}

export interface HistoryEntry {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: string;
  toolCalls?: unknown;
  toolCallId?: string;
  toolName?: string;
}

// Global agent definition (config only — no history)
export interface AgentDefinition {
  id: string;
  identity: AgentIdentity;
  hatType: HatType[];
  model: string;
  providerName: string;
  teamContext?: string;
  enabledMcpServers?: string[];
  personalMcpCredentials?: Record<string, Record<string, string>>;
  disabledPersonalMcpServers?: string[];
  scheduledActionIds: string[];
}

// Global scheduled action definition
export type ScheduledActionType = 'prompt' | 'mcp_tool_call';

export interface ScheduledActionDef {
  id: string;
  label: string;
  description: string;
  intervalSeconds: number | null;
  createdAt: string;
  type?: ScheduledActionType;
  mcpToolCall?: McpToolCallSpec;
}

// V1 format kept for migration only
export interface AgentSnapshot {
  id: string;
  identity: AgentIdentity;
  hatType: HatType | HatType[];
  model: string;
  providerName: string;
  teamContext?: string;
  enabledMcpServers?: string[];
  personalMcpCredentials?: Record<string, Record<string, string>>;
  history: HistoryEntry[];
}

export interface TeamSnapshotV1 {
  version: 1;
  savedAt: string;
  humanName: string;
  agents: AgentSnapshot[];
  tasks: Task[];
  meetings: Meeting[];
  mcpServers: MCPServerDef[];
}

export interface TeamSnapshotV2 {
  version: 2;
  savedAt: string;
  humanName: string;
  agentIds: string[];
  /** @deprecated single 'general' thread only — use agentThreads when present */
  agentHistories: Record<string, HistoryEntry[]>;
  /** All threads keyed by agentId → threadKey → messages */
  agentThreads?: Record<string, Record<string, HistoryEntry[]>>;
  tasks: Task[];
  meetings: Meeting[];
  mcpServers: MCPServerDef[];
}

export type TeamSnapshot = TeamSnapshotV1 | TeamSnapshotV2;
