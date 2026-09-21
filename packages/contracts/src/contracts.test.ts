import { describe, it, expect } from 'vitest';
import {
  createAgentTemplate, createDeployedAgent, createProject, deployTemplate,
  patchAgentTemplate, replaceAgentTemplate, reviseProject, slugifyProjectId, summariseProject,
} from './factories.js';
import { listSchemas, readSchema, validateAgentTemplate, validateDeployedAgent, validateProject } from './validate.js';
import { readOpenApiJson, OPENAPI_FILES } from './openapi.js';
import { HAT_TYPE_NAMES, PROVIDER_NAMES, SCHEMA_VERSION, type AgentTemplateInput } from './types.js';

const MINIMAL_TEMPLATE: AgentTemplateInput = {
  name: 'Amara',
  hats: ['blue'],
  identity: { visualDescription: 'poised and organised' },
  model: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
};

describe('schemas', () => {
  it('every schema is loadable and carries an $id', () => {
    for (const name of listSchemas()) {
      const schema = readSchema(name);
      expect(schema['$id'], `${name} needs an $id for $ref resolution`).toBeTypeOf('string');
    }
  });

  it('the documented examples validate against their own schema', () => {
    for (const [name, validate] of [
      ['agentTemplate', validateAgentTemplate],
      ['deployedAgent', validateDeployedAgent],
      ['project', validateProject],
    ] as const) {
      const examples = readSchema(name)['examples'] as unknown[];
      expect(examples?.length, `${name} should document at least one example`).toBeGreaterThan(0);
      for (const example of examples) {
        const result = validate(example);
        expect(result.errors, `${name} example failed`).toEqual([]);
      }
    }
  });

  it('the TypeScript enums match the schema enums', () => {
    const common = readSchema('common') as { $defs: Record<string, { enum?: string[] }> };
    expect(common.$defs['hatType']?.enum).toEqual([...HAT_TYPE_NAMES]);
    expect(common.$defs['providerName']?.enum).toEqual([...PROVIDER_NAMES]);
  });
});

describe('agent templates', () => {
  it('creates a schema-valid template from minimal input', () => {
    const template = createAgentTemplate(MINIMAL_TEMPLATE);
    expect(validateAgentTemplate(template).errors).toEqual([]);
    expect(template.schemaVersion).toBe(SCHEMA_VERSION);
    expect(template.revision).toBe(1);
  });

  it('defaults an agent with no hats to the "none" hat', () => {
    const template = createAgentTemplate({ name: 'Nobody' });
    expect(template.hats).toEqual(['none']);
    expect(validateAgentTemplate(template).errors).toEqual([]);
  });

  it('rejects an unknown hat', () => {
    const bad = { ...createAgentTemplate(MINIMAL_TEMPLATE), hats: ['purple'] };
    const result = validateAgentTemplate(bad);
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.path).toBe('/hats/0');
  });

  it('rejects unknown top-level properties', () => {
    const bad = { ...createAgentTemplate(MINIMAL_TEMPLATE), rogueField: true };
    expect(validateAgentTemplate(bad).valid).toBe(false);
  });

  it('bumps the revision and preserves identity on patch', () => {
    const template = createAgentTemplate(MINIMAL_TEMPLATE);
    const patched = patchAgentTemplate(template, { description: 'Facilitator' });
    expect(patched.revision).toBe(2);
    expect(patched.id).toBe(template.id);
    expect(patched.createdAt).toBe(template.createdAt);
    expect(patched.name).toBe('Amara');
    expect(validateAgentTemplate(patched).errors).toEqual([]);
  });

  it('replaces on PUT, so an omitted field is cleared', () => {
    const template = createAgentTemplate({
      ...MINIMAL_TEMPLATE,
      tools: { enabledMcpServers: ['kanban', 'filesystem'] },
      description: 'has an allow-list',
    });
    expect(template.tools?.enabledMcpServers).toEqual(['kanban', 'filesystem']);

    // Omitting tools must drop the allow-list — that is how the editor turns
    // an explicit selection back into "every team server".
    const replaced = replaceAgentTemplate(template, MINIMAL_TEMPLATE);
    expect(replaced.tools).toBeUndefined();
    expect(replaced.description).toBeUndefined();
    expect(replaced.id).toBe(template.id);
    expect(replaced.createdAt).toBe(template.createdAt);
    expect(replaced.revision).toBe(template.revision + 1);
    expect(validateAgentTemplate(replaced).errors).toEqual([]);
  });

  it('keeps an omitted field on PATCH, unlike PUT', () => {
    const template = createAgentTemplate({
      ...MINIMAL_TEMPLATE,
      tools: { enabledMcpServers: ['kanban'] },
    });
    const patched = patchAgentTemplate(template, { description: 'still has tools' });
    expect(patched.tools?.enabledMcpServers).toEqual(['kanban']);
  });

  it('distinguishes an empty allow-list from an absent one', () => {
    const none = createAgentTemplate({ ...MINIMAL_TEMPLATE, tools: { enabledMcpServers: [] } });
    expect(none.tools?.enabledMcpServers).toEqual([]);
    expect(validateAgentTemplate(none).errors).toEqual([]);

    const all = createAgentTemplate(MINIMAL_TEMPLATE);
    expect(all.tools).toBeUndefined();
  });

  it('merges identity rather than replacing it', () => {
    const template = createAgentTemplate({ ...MINIMAL_TEMPLATE, identity: { visualDescription: 'poised', backstory: 'ran teams' } });
    const patched = patchAgentTemplate(template, { identity: { specialisation: 'Leadership' } });
    expect(patched.identity.backstory).toBe('ran teams');
    expect(patched.identity.specialisation).toBe('Leadership');
  });
});

describe('deploying a template', () => {
  it('produces a schema-valid deployed agent that records its template revision', () => {
    const template = createAgentTemplate(MINIMAL_TEMPLATE);
    const deployed = deployTemplate(template, { projectRole: 'facilitator' });
    expect(validateDeployedAgent(deployed).errors).toEqual([]);
    expect(deployed.templateId).toBe(template.id);
    expect(deployed.templateRevision).toBe(template.revision);
    expect(deployed.enabled).toBe(true);
  });

  it('honours a project-local name override without touching the template', () => {
    const template = createAgentTemplate(MINIMAL_TEMPLATE);
    const deployed = deployTemplate(template, { name: 'Amara 2' });
    expect(deployed.name).toBe('Amara 2');
    expect(template.name).toBe('Amara');
  });

  it('creates a template-less deployed agent', () => {
    const agent = createDeployedAgent({ name: 'Ad hoc' });
    expect(validateDeployedAgent(agent).errors).toEqual([]);
    expect(agent.templateId).toBeUndefined();
  });
});

describe('projects', () => {
  it('creates a schema-valid project with an empty team', () => {
    const project = createProject({ id: 'acme', name: 'Acme' });
    expect(validateProject(project).errors).toEqual([]);
    expect(project.team).toEqual([]);
    expect(project.humanName).toBe('Human');
  });

  it('validates the whole team through the deployed-agent schema', () => {
    const deployed = deployTemplate(createAgentTemplate(MINIMAL_TEMPLATE));
    const good = createProject({ id: 'acme', name: 'Acme', team: [deployed] });
    expect(validateProject(good).errors).toEqual([]);

    const bad = { ...good, team: [{ ...deployed, hats: ['chartreuse'] }] };
    const result = validateProject(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.startsWith('/team/0/hats'))).toBe(true);
  });

  it('bumps the revision and keeps the id on revise', () => {
    const project = createProject({ id: 'acme', name: 'Acme' });
    const revised = reviseProject(project, { goal: 'Ship it' });
    expect(revised.revision).toBe(2);
    expect(revised.id).toBe('acme');
    expect(revised.goal).toBe('Ship it');
    expect(validateProject(revised).errors).toEqual([]);
  });

  it('replaces the team wholesale rather than merging it', () => {
    const deployed = deployTemplate(createAgentTemplate(MINIMAL_TEMPLATE));
    const project = createProject({ id: 'acme', name: 'Acme', team: [deployed] });
    expect(reviseProject(project, { team: [] }).team).toEqual([]);
  });

  it('turns the shared MCP servers off when the last one is unticked', () => {
    // An empty list here means "this team runs no shared servers", which is
    // not the same as "I did not mention them".
    const project = createProject({
      id: 'acme', name: 'Acme',
      mcpServers: [{ name: 'kanban', config: { transport: 'stdio', command: 'node', args: ['k.js'] } }],
    });
    expect(reviseProject(project, { mcpServers: [] }).mcpServers).toEqual([]);
  });

  it('leaves the shared MCP servers alone when a revision does not mention them', () => {
    const servers = [{ name: 'kanban', config: { transport: 'stdio' as const, command: 'node', args: ['k.js'] } }];
    const project = createProject({ id: 'acme', name: 'Acme', mcpServers: servers });
    expect(reviseProject(project, { goal: 'Ship it' }).mcpServers).toEqual(servers);
  });

  it('summarises without leaking the team', () => {
    const deployed = deployTemplate(createAgentTemplate(MINIMAL_TEMPLATE));
    const summary = summariseProject(createProject({ id: 'acme', name: 'Acme', team: [deployed] }), true);
    expect(summary.teamSize).toBe(1);
    expect(summary.active).toBe(true);
    expect(summary).not.toHaveProperty('team');
  });

  it('slugifies arbitrary names into valid project ids', () => {
    const pattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;
    for (const input of ['Acme Launch', '  Spaces  ', 'Ünïcödé Ström', '2026 Plan', '!!!weird!!!']) {
      expect(slugifyProjectId(input), `"${input}"`).toMatch(pattern);
    }
  });
});

describe('openapi documents', () => {
  it('every bundled document parses and declares paths', () => {
    for (const name of Object.keys(OPENAPI_FILES) as Array<keyof typeof OPENAPI_FILES>) {
      const doc = readOpenApiJson(name) as { openapi?: string; paths?: Record<string, unknown> };
      expect(doc.openapi, `${name} openapi version`).toMatch(/^3\./);
      expect(Object.keys(doc.paths ?? {}).length, `${name} paths`).toBeGreaterThan(0);
    }
  });

  it('every operation has a unique operationId', () => {
    for (const name of Object.keys(OPENAPI_FILES) as Array<keyof typeof OPENAPI_FILES>) {
      const doc = readOpenApiJson(name) as { paths: Record<string, Record<string, { operationId?: string }>> };
      const ids: string[] = [];
      for (const operations of Object.values(doc.paths)) {
        for (const [method, operation] of Object.entries(operations)) {
          if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
          expect(operation.operationId, `${name} ${method} is missing an operationId`).toBeTypeOf('string');
          ids.push(operation.operationId as string);
        }
      }
      expect(new Set(ids).size, `${name} has duplicate operationIds`).toBe(ids.length);
    }
  });
});
