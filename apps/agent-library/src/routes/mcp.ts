/**
 * MCP configuration for a template.
 *
 * Two halves that live in different places on purpose: which servers a template
 * uses is part of the template document, while the credentials that make them
 * work stay in the runner-local sidecar and are never returned in the clear.
 */

import {
  badRequest, json, noContent, notFound, readJsonBody,
  del, get, put, type Route,
} from '@hats/service-kit/index';
import { getCatalogue } from '@hats/core/mcp/catalogue-store';
import {
  envVarName, envVarPlaceholder, isAgentMcp, isHumanMcp, type MCPCatalogueEntry,
} from '@hats/core/mcp/mcp-catalogue';
import type { CredentialStore, CredentialSet } from '../credential-store.js';
import { maskCredentials } from '../credential-store.js';
import type { TemplateStore } from '../template-store.js';

const BASE = '/api/v1';

/** The client only needs the shape of an entry, not its transport config. */
function describe(entry: MCPCatalogueEntry) {
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    category: entry.category,
    url: entry.url,
    notes: entry.notes,
    // Entries are either a bare name or a {name, placeholder} pair.
    envVars: (entry.envVars ?? [])
      .map((v) => ({ name: envVarName(v), placeholder: envVarPlaceholder(v) }))
      .filter((v) => v.name),
    // What the server offered the last time the runner connected to it. The
    // library starts no MCP servers, so without this it has nothing to list.
    knownTools: entry.knownTools ?? [],
    toolsDiscoveredAt: entry.toolsDiscoveredAt,
  };
}

export function mcpRoutes(templates: TemplateStore, credentials: CredentialStore): Route[] {
  const templateOr404 = (res: Parameters<typeof notFound>[0], id: string) => {
    const template = templates.get(id);
    if (!template) { notFound(res, 'Template'); return null; }
    return template;
  };

  return [
    get(`${BASE}/mcp/catalogue`, ({ res }) => {
      const all = getCatalogue();
      json(res, 200, {
        personal: all.filter(isAgentMcp).map(describe),
        // A team server's env vars come from this machine's environment, not
        // from the agent, so the editor can say up front which will actually
        // start. A personal server's credentials are the agent's own and are
        // reported separately, masked.
        shared: all.filter(isHumanMcp).map((e) => ({
          ...describe(e),
          envVars: (e.envVars ?? [])
            .map((v) => ({
              name: envVarName(v),
              placeholder: envVarPlaceholder(v),
              present: Boolean(process.env[envVarName(v)]),
            }))
            .filter((v) => v.name),
        })),
      });
    }),

    // What this template has configured. Secrets come back masked.
    get(`${BASE}/agent-templates/:id/personal-mcp`, async ({ res, params }) => {
      const id = params['id'] as string;
      if (!templateOr404(res, id)) return;
      const stored = await credentials.credentialsFor(id);
      const disabled = new Set(await credentials.disabledFor(id));
      json(res, 200, {
        servers: Object.entries(stored).map(([serverId, values]) => ({
          id: serverId,
          configured: true,
          disabled: disabled.has(serverId),
          values: maskCredentials(values),
        })),
      });
    }),

    put(`${BASE}/agent-templates/:id/personal-mcp/:serverId`, async ({ req, res, params }) => {
      const id = params['id'] as string;
      const serverId = params['serverId'] as string;
      if (!templateOr404(res, id)) return;
      if (!getCatalogue().some((e) => e.id === serverId && isAgentMcp(e))) {
        badRequest(res, `"${serverId}" is not a per-agent MCP server`); return;
      }
      const body = await readJsonBody<{ values?: CredentialSet; disabled?: boolean }>(req);
      if (!body?.values) { badRequest(res, 'values is required'); return; }

      const saved = await credentials.saveServer(id, serverId, body.values);
      if (body.disabled) await credentials.setDisabled(id, serverId, true);
      json(res, 200, { id: serverId, configured: true, disabled: Boolean(body.disabled), values: maskCredentials(saved) });
    }),

    del(`${BASE}/agent-templates/:id/personal-mcp/:serverId`, async ({ res, params }) => {
      const id = params['id'] as string;
      if (!templateOr404(res, id)) return;
      const removed = await credentials.removeServer(id, params['serverId'] as string);
      if (!removed) { notFound(res, 'Configured server'); return; }
      noContent(res);
    }),
  ];
}
