/**
 * A saved team state, made safe to leave this machine.
 *
 * Older snapshots carried each agent's personal MCP credentials — mailbox
 * passwords, tokens — and every shared server's keys as they were resolved.
 * A project export packs the whole folder, so without this they all went in
 * the zip whether --credentials was asked for or not. Here the credentials
 * are taken out (and handed back, for an export that asked for them to go
 * with the agents' other secrets), and server configs keep nothing from this
 * machine's environment.
 */

import { portableConfig } from '../../../packages/core/src/mcp/saved-config.js';
import type { MCPServerDef } from '../mcp/mcp-client.js';

type Credentials = Record<string, Record<string, string>>;

export interface CleanSnapshot {
  text: string;
  /** Agent id → the credentials taken out of it. */
  credentials: Record<string, Credentials>;
  /** Every agent the snapshot holds, with what an export needs to bring it along. */
  agents: SnapshotAgent[];
}

export interface SnapshotAgent {
  id: string;
  templateId?: string;
  identity?: { avatar?: string; background?: string; voice?: string };
  scheduledActionIds?: string[];
}

/** Saved team states, the current one and any copies kept beside it. */
export const SNAPSHOT_FILE = /^team-state[^/]*\.json$/;

type AgentLike = Partial<SnapshotAgent> & { personalMcpCredentials?: Credentials };

const described = (id: string, a: AgentLike): SnapshotAgent => ({
  id,
  ...(a.templateId && { templateId: a.templateId }),
  ...(a.identity && { identity: a.identity }),
  ...(a.scheduledActionIds && { scheduledActionIds: a.scheduledActionIds }),
});

function takeCredentials(agent: AgentLike, id: string, into: Record<string, Credentials>): void {
  if (agent.personalMcpCredentials && Object.keys(agent.personalMcpCredentials).length > 0) {
    into[id] = agent.personalMcpCredentials;
  }
  delete agent.personalMcpCredentials;
}

export function cleanServers(
  servers: MCPServerDef[] | undefined,
  env: Record<string, string | undefined>,
  includeCredentials: boolean,
): MCPServerDef[] | undefined {
  return servers?.map((s) => ({ ...s, config: portableConfig(s.config, env, { dropSecrets: !includeCredentials }) }));
}

export function cleanSnapshot(
  text: string,
  { env = process.env, includeCredentials = false }: { env?: Record<string, string | undefined>; includeCredentials?: boolean } = {},
): CleanSnapshot {
  let snapshot: Record<string, unknown>;
  try { snapshot = JSON.parse(text) as Record<string, unknown>; } catch { return { text, credentials: {}, agents: [] }; }

  const credentials: Record<string, Credentials> = {};
  const agents: SnapshotAgent[] = [];
  if (Array.isArray(snapshot['agents'])) {
    for (const agent of snapshot['agents'] as AgentLike[]) {
      if (!agent.id) continue;
      agents.push(described(agent.id, agent));
      takeCredentials(agent, agent.id, credentials);
    }
  } else if (snapshot['agents'] && typeof snapshot['agents'] === 'object') {
    for (const [id, agent] of Object.entries(snapshot['agents'] as Record<string, AgentLike>)) {
      agents.push(described(id, agent));
      takeCredentials(agent, id, credentials);
    }
  }
  for (const id of (snapshot['agentIds'] as string[] | undefined) ?? []) {
    if (!agents.some((a) => a.id === id)) agents.push({ id });
  }
  const servers = snapshot['mcpServers'] as MCPServerDef[] | undefined;
  const cleaned = cleanServers(servers, env, includeCredentials);
  const changed = Object.keys(credentials).length > 0 || JSON.stringify(cleaned) !== JSON.stringify(servers);
  // Untouched, the file travels exactly as it was.
  if (!changed) return { text, credentials, agents };
  if (cleaned) snapshot['mcpServers'] = cleaned;
  return { text: JSON.stringify(snapshot, null, 2), credentials, agents };
}
