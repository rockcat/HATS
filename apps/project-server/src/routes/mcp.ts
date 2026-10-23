/**
 * The team's shared MCP servers.
 *
 * A project definition carries the servers the whole team runs, as name plus
 * transport config. The Designer picks them by catalogue id and never sees a
 * command line: the expansion happens here, so a catalogue change reaches every
 * project without anyone editing a stored document.
 *
 * Per-agent servers are not offered. Those carry one agent's own credentials
 * and belong to the Agent Library and the runner's local sidecar, never to a
 * project definition that gets shared around.
 */

import { get, json, type Route } from '@hats/service-kit/index';
import { getCatalogue } from '@hats/core/mcp/catalogue-store';
import {
  envVarName, envVarPlaceholder, isHumanMcp, type MCPCatalogueEntry,
} from '@hats/core/mcp/mcp-catalogue';
import type { McpServerDefinition } from '@hats/contracts/types';

const BASE = '/api/v1';

/**
 * What a picker needs: what the server is, and whether this machine has the
 * environment set to actually run it. The transport config is deliberately
 * absent — the browser has no use for a command line.
 */
function describe(entry: MCPCatalogueEntry) {
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    category: entry.category,
    ...(entry.url && { url: entry.url }),
    ...(entry.notes && { notes: entry.notes }),
    envVars: (entry.envVars ?? [])
      .map((v) => ({
        name: envVarName(v),
        placeholder: envVarPlaceholder(v),
        // Reported as set or not; the value itself never leaves the server.
        present: Boolean(process.env[envVarName(v)]),
      }))
      .filter((v) => v.name),
  };
}

/** The shared servers a project may run, in catalogue order. */
export function sharedCatalogue(): MCPCatalogueEntry[] {
  return getCatalogue().filter(isHumanMcp);
}

/**
 * Turn catalogue ids into the definitions a project stores.
 *
 * An id that is not in the catalogue is dropped rather than stored as a broken
 * server; `unknown` names them so the caller can say so.
 */
export function resolveServerIds(ids: string[]): {
  servers: McpServerDefinition[];
  unknown: string[];
} {
  const byId = new Map(sharedCatalogue().map((e) => [e.id, e]));
  const servers: McpServerDefinition[] = [];
  const unknown: string[] = [];

  for (const id of [...new Set(ids)]) {
    const entry = byId.get(id);
    if (!entry) { unknown.push(id); continue; }
    // The name is the catalogue id: that is what an agent's enabledMcpServers
    // list refers to, and what the runner starts the server as.
    servers.push({ name: entry.id, config: { ...entry.config } } as McpServerDefinition);
  }
  return { servers, unknown };
}

export function mcpRoutes(): Route[] {
  return [
    get(`${BASE}/mcp/catalogue`, ({ res }) => {
      json(res, 200, { servers: sharedCatalogue().map(describe) });
    }),
  ];
}
