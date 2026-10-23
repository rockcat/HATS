/** CRUD routes over the agent library. */

import {
  badRequest, json, noContent, notFound, readJsonBody,
  del, get, patch, post, put, type Route, type RequestContext,
} from '@hats/service-kit/index';
import type { AgentTemplateInput } from '@hats/contracts/types';
import type { TemplateStore } from '../template-store.js';
import { renderTemplatePrompt } from '../prompt-preview.js';

const BASE = '/api/v1/agent-templates';

function detailsOf(err: unknown): Array<{ path: string; message: string }> | undefined {
  const detail = (err as { details?: unknown }).details;
  return Array.isArray(detail) ? detail as Array<{ path: string; message: string }> : undefined;
}

export function templateRoutes(store: TemplateStore): Route[] {
  const write = async (ctx: RequestContext, action: () => Promise<unknown>, okStatus: number) => {
    try {
      const result = await action();
      if (result === undefined) { notFound(ctx.res, 'Template'); return; }
      json(ctx.res, okStatus, result);
    } catch (err) {
      badRequest(ctx.res, (err as Error).message, detailsOf(err));
    }
  };

  return [
    get(BASE, ({ res, query }) => {
      const templates = store.list({
        q: query.get('q') ?? undefined,
        hat: query.get('hat') ?? undefined,
        tag: query.get('tag') ?? undefined,
      });
      json(res, 200, { templates, total: templates.length });
    }),

    post(BASE, async (ctx) => {
      const body = await readJsonBody<AgentTemplateInput>(ctx.req);
      if (!body?.name?.trim()) { badRequest(ctx.res, 'name is required'); return; }
      await write(ctx, () => store.create(body), 201);
    }),

    get(`${BASE}/:id`, ({ res, params }) => {
      const template = store.get(params['id'] as string);
      if (!template) { notFound(res, 'Template'); return; }
      json(res, 200, template);
    }),

    put(`${BASE}/:id`, async (ctx) => {
      const body = await readJsonBody<AgentTemplateInput>(ctx.req);
      if (!body?.name?.trim()) { badRequest(ctx.res, 'name is required'); return; }
      // PUT replaces: an omitted field is cleared, which is how the editor
      // turns an explicit MCP allow-list back into "every team server".
      await write(ctx, () => store.replace(ctx.params['id'] as string, body), 200);
    }),

    patch(`${BASE}/:id`, async (ctx) => {
      const body = await readJsonBody<Partial<AgentTemplateInput>>(ctx.req);
      if (!body) { badRequest(ctx.res, 'A JSON body is required'); return; }
      await write(ctx, () => store.update(ctx.params['id'] as string, body), 200);
    }),

    del(`${BASE}/:id`, async ({ res, params }) => {
      const removed = await store.remove(params['id'] as string);
      if (!removed) { notFound(res, 'Template'); return; }
      noContent(res);
    }),

    post(`${BASE}/:id/duplicate`, async (ctx) => {
      const body = await readJsonBody<{ name?: string }>(ctx.req);
      await write(ctx, () => store.duplicate(ctx.params['id'] as string, body?.name), 201);
    }),

    get(`${BASE}/:id/prompt-preview`, ({ res, params }) => {
      const template = store.get(params['id'] as string);
      if (!template) { notFound(res, 'Template'); return; }
      json(res, 200, { prompt: renderTemplatePrompt(template) });
    }),

    // Render from unsaved input — the editor calls this on every change so the
    // prompt panel tracks what the user is typing.
    post('/api/v1/prompt-preview', async ({ req, res }) => {
      const body = await readJsonBody<AgentTemplateInput>(req);
      if (!body) { badRequest(res, 'A JSON body is required'); return; }
      json(res, 200, { prompt: renderTemplatePrompt(body) });
    }),
  ];
}
