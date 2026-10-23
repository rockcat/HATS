/** Project lifecycle and definition routes. */

import {
  badRequest, conflict, json, noContent, notFound, readJsonBody,
  del, get, patch, post, put, type RequestContext, type Route,
} from '@hats/service-kit/index';
import { isValidProjectId, slugifyProjectId } from '@hats/contracts/factories';
import type { ProjectDefinition } from '@hats/contracts/types';
import { ProjectStore, RevisionConflictError, ValidationError } from '../project-store.js';
import { resolveServerIds } from './mcp.js';

const BASE = '/api/v1';

/**
 * `mcpServerIds` is the Designer's way of setting the team's shared servers:
 * catalogue ids in, full definitions stored. `mcpServers` is still accepted
 * whole, which is how the runner writes back what it actually started.
 */
type ProjectWrite = Partial<ProjectDefinition> & {
  expectedRevision?: number;
  mcpServerIds?: string[];
};

/** Translate store errors into the uniform error contract. */
export async function withStoreErrors(ctx: RequestContext, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (err) {
    if (err instanceof RevisionConflictError) { conflict(ctx.res, err.message); return; }
    if (err instanceof ValidationError) { badRequest(ctx.res, err.message, err.details); return; }
    throw err;
  }
}

export function projectRoutes(store: ProjectStore): Route[] {
  return [
    get(`${BASE}/projects`, ({ res }) =>
      json(res, 200, { projects: store.listSummaries(), activeProjectId: store.activeProjectId })),

    post(`${BASE}/projects`, async (ctx) => {
      const body = await readJsonBody<{ id?: string; name?: string } & ProjectWrite>(ctx.req);
      if (!body?.name?.trim()) { badRequest(ctx.res, 'name is required'); return; }
      const id = (body.id?.trim() || slugifyProjectId(body.name));
      if (!isValidProjectId(id)) {
        badRequest(ctx.res, `"${id}" is not a valid project id — letters, digits, spaces, dashes and underscores only`);
        return;
      }
      if (store.has(id)) { conflict(ctx.res, `A project with id "${id}" already exists`); return; }
      await withStoreErrors(ctx, async () => {
        const created = await store.create({
          id,
          name: body.name as string,
          ...(body.description !== undefined && { description: body.description }),
          ...(body.goal !== undefined && { goal: body.goal }),
          ...(body.humanName !== undefined && { humanName: body.humanName }),
          ...(body.team !== undefined && { team: body.team }),
          ...(body.mcpServers !== undefined && { mcpServers: body.mcpServers }),
          ...(body.mcpServerIds !== undefined && { mcpServers: resolveServerIds(body.mcpServerIds).servers }),
          ...(body.settings !== undefined && { settings: body.settings }),
        });
        json(ctx.res, 201, created);
      });
    }),

    get(`${BASE}/projects/:id`, ({ res, params }) => {
      const project = store.get(params['id'] as string);
      if (!project) { notFound(res, 'Project'); return; }
      json(res, 200, project);
    }),

    put(`${BASE}/projects/:id`, async (ctx) => {
      const body = await readJsonBody<ProjectWrite>(ctx.req);
      if (!body) { badRequest(ctx.res, 'A JSON body is required'); return; }
      await applyUpdate(ctx, store, body);
    }),

    patch(`${BASE}/projects/:id`, async (ctx) => {
      const body = await readJsonBody<ProjectWrite>(ctx.req);
      if (!body) { badRequest(ctx.res, 'A JSON body is required'); return; }
      await applyUpdate(ctx, store, body);
    }),

    del(`${BASE}/projects/:id`, async ({ res, params, query }) => {
      const purge = query.get('purge') === 'true';
      const removed = await store.remove(params['id'] as string, purge);
      if (!removed) { notFound(res, 'Project'); return; }
      noContent(res);
    }),

    get(`${BASE}/active`, ({ res }) => {
      const id = store.activeProjectId;
      json(res, 200, { activeProjectId: id, project: id ? store.get(id) ?? null : null });
    }),

    put(`${BASE}/active`, async ({ req, res }) => {
      const body = await readJsonBody<{ id: string }>(req);
      if (!body?.id) { badRequest(res, 'id is required'); return; }
      if (!(await store.setActive(body.id))) { notFound(res, 'Project'); return; }
      json(res, 200, { activeProjectId: body.id, project: store.get(body.id) });
    }),
  ];
}

async function applyUpdate(ctx: RequestContext, store: ProjectStore, body: ProjectWrite): Promise<void> {
  const { expectedRevision, mcpServerIds, ...rest } = body;

  if (mcpServerIds !== undefined) {
    const { servers, unknown } = resolveServerIds(mcpServerIds);
    if (unknown.length) {
      badRequest(ctx.res, `Not shared MCP servers in the catalogue: ${unknown.join(', ')}`);
      return;
    }
    rest.mcpServers = servers;
  }
  // These are server-owned; a client echoing a whole document back must not move them.
  delete (rest as Record<string, unknown>)['id'];
  delete (rest as Record<string, unknown>)['revision'];
  delete (rest as Record<string, unknown>)['createdAt'];
  delete (rest as Record<string, unknown>)['updatedAt'];

  await withStoreErrors(ctx, async () => {
    const updated = await store.update(ctx.params['id'] as string, rest, expectedRevision);
    if (!updated) { notFound(ctx.res, 'Project'); return; }
    json(ctx.res, 200, updated);
  });
}
