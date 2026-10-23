/** Routes over the deployed agents inside a project. */

import {
  badRequest, fail, json, noContent, notFound, readJsonBody,
  del, get, patch, post, type Route,
} from '@hats/service-kit/index';
import { createDeployedAgent, deployTemplate } from '@hats/contracts/factories';
import { validateDeployedAgent } from '@hats/contracts/validate';
import type { AgentLibraryClient } from '@hats/clients/agent-library-client';
import { ServiceUnavailableError } from '@hats/clients/http-client';
import type { DeployedAgent } from '@hats/contracts/types';
import type { ProjectStore } from '../project-store.js';
import { withStoreErrors } from './projects.js';

const BASE = '/api/v1/projects/:id/team';

interface DeployRequest {
  templateId?: string;
  name?: string;
  projectRole?: string;
  agent?: DeployedAgent;
}

export function teamRoutes(store: ProjectStore, library: AgentLibraryClient): Route[] {
  return [
    get(BASE, ({ res, params }) => {
      const project = store.get(params['id'] as string);
      if (!project) { notFound(res, 'Project'); return; }
      json(res, 200, { team: project.team });
    }),

    post(BASE, async (ctx) => {
      const projectId = ctx.params['id'] as string;
      const project = store.get(projectId);
      if (!project) { notFound(ctx.res, 'Project'); return; }

      const body = await readJsonBody<DeployRequest>(ctx.req);
      if (!body?.templateId && !body?.agent) {
        badRequest(ctx.res, 'Supply either templateId or a complete agent document');
        return;
      }

      let agent: DeployedAgent;
      if (body.templateId) {
        let template;
        try {
          template = await library.getTemplate(body.templateId);
        } catch (err) {
          if (err instanceof ServiceUnavailableError) {
            fail(ctx.res, 502, err.message, 'agent_library_unreachable');
            return;
          }
          throw err;
        }
        if (!template) { notFound(ctx.res, 'Agent template'); return; }
        agent = deployTemplate(template, {
          ...(body.name !== undefined && { name: body.name }),
          ...(body.projectRole !== undefined && { projectRole: body.projectRole }),
        });
      } else {
        agent = createDeployedAgent(body.agent as DeployedAgent);
      }

      const check = validateDeployedAgent(agent);
      if (!check.valid) { badRequest(ctx.res, 'Deployed agent failed schema validation', check.errors); return; }
      if (project.team.some((a) => a.name.toLowerCase() === agent.name.toLowerCase())) {
        badRequest(ctx.res, `"${agent.name}" is already on this team — give the deployment a different name`);
        return;
      }

      await withStoreErrors(ctx, async () => {
        await store.update(projectId, { team: [...project.team, agent] });
        json(ctx.res, 201, agent);
      });
    }),

    patch(`${BASE}/:instanceId`, async (ctx) => {
      const projectId = ctx.params['id'] as string;
      const instanceId = ctx.params['instanceId'] as string;
      const project = store.get(projectId);
      if (!project) { notFound(ctx.res, 'Project'); return; }
      const existing = project.team.find((a) => a.instanceId === instanceId);
      if (!existing) { notFound(ctx.res, 'Deployed agent'); return; }

      const body = await readJsonBody<Partial<DeployedAgent>>(ctx.req);
      if (!body) { badRequest(ctx.res, 'A JSON body is required'); return; }

      const merged: DeployedAgent = {
        ...existing,
        ...body,
        instanceId: existing.instanceId,
        schemaVersion: existing.schemaVersion,
        deployedAt: existing.deployedAt,
        ...(body.identity && { identity: { ...existing.identity, ...body.identity } }),
        ...(body.model && { model: { ...existing.model, ...body.model } }),
      };

      const check = validateDeployedAgent(merged);
      if (!check.valid) { badRequest(ctx.res, 'Deployed agent failed schema validation', check.errors); return; }

      await withStoreErrors(ctx, async () => {
        await store.update(projectId, {
          team: project.team.map((a) => (a.instanceId === instanceId ? merged : a)),
        });
        json(ctx.res, 200, merged);
      });
    }),

    del(`${BASE}/:instanceId`, async (ctx) => {
      const projectId = ctx.params['id'] as string;
      const instanceId = ctx.params['instanceId'] as string;
      const project = store.get(projectId);
      if (!project) { notFound(ctx.res, 'Project'); return; }
      if (!project.team.some((a) => a.instanceId === instanceId)) { notFound(ctx.res, 'Deployed agent'); return; }

      await withStoreErrors(ctx, async () => {
        await store.update(projectId, { team: project.team.filter((a) => a.instanceId !== instanceId) });
        noContent(ctx.res);
      });
    }),
  ];
}
