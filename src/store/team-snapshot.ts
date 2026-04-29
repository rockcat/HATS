import { AgentIdentity } from '../agent/types.js';
import { HatType } from '../hats/types.js';
import { MCPServerDef } from '../mcp/mcp-client.js';
import { Task, Meeting } from '../orchestrator/types.js';

export const SNAPSHOT_VERSION = 1;

export interface AgentSnapshot {
  id: string;             // stable UUID, used as map key so renames don't break anything
  identity: AgentIdentity;
  hatType: HatType;
  model: string;
  providerName: string;   // used by ProviderFactory to reconstruct the right provider
  teamContext?: string;
  enabledMcpServers?: string[]; // per-agent MCP server IDs; absent = all project servers
  history: Array<{
    role: 'user' | 'assistant' | 'tool';
    content: string;
    timestamp: string;    // ISO string — Date isn't JSON-serializable
    toolCalls?: unknown;
    toolCallId?: string;
    toolName?: string;
  }>;
}

export interface TeamSnapshot {
  version: number;
  savedAt: string;        // ISO string
  humanName: string;
  agents: AgentSnapshot[];
  tasks: Task[];
  meetings: Meeting[];
  mcpServers: MCPServerDef[];
}
