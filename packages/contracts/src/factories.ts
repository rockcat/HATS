/**
 * Constructors and normalisers for contract documents.
 *
 * Every service creates contract documents through these helpers so that
 * defaults, timestamps and revision bookkeeping stay identical everywhere.
 */

import { randomUUID } from 'crypto';
import {
  SCHEMA_VERSION,
  type AgentIdentitySpec,
  type AgentTemplate,
  type AgentTemplateInput,
  type DeployedAgent,
  type HatTypeName,
  type ModelBinding,
  type ProjectDefinition,
  type ProjectSummary,
} from './types.js';

export const DEFAULT_IDENTITY: AgentIdentitySpec = {
  visualDescription: 'a focused, capable team member',
};

export const DEFAULT_MODEL: ModelBinding = {
  provider: 'anthropic',
  model: 'claude-haiku-4-5-20251001',
};

const nowIso = (): string => new Date().toISOString();

/** Drop keys whose value is undefined, empty string or empty array. */
function compact<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    if (Array.isArray(value) && value.length === 0 && key !== 'team') continue;
    out[key] = typeof value === 'string' ? value.trim() : value;
  }
  return out as T;
}

function normaliseIdentity(identity: Partial<AgentIdentitySpec> | undefined): AgentIdentitySpec {
  const merged = { ...DEFAULT_IDENTITY, ...(identity ?? {}) };
  const compacted = compact(merged as unknown as Record<string, unknown>) as unknown as AgentIdentitySpec;
  if (!compacted.visualDescription) compacted.visualDescription = DEFAULT_IDENTITY.visualDescription;
  return compacted;
}

function normaliseHats(hats: HatTypeName[] | undefined): HatTypeName[] {
  const list = (hats ?? []).filter(Boolean);
  return list.length > 0 ? [...new Set(list)] : ['none'];
}

/** Build a brand new template from partial client input. */
export function createAgentTemplate(input: AgentTemplateInput, id: string = randomUUID()): AgentTemplate {
  const ts = nowIso();
  return compact({
    schemaVersion: SCHEMA_VERSION,
    id,
    name: input.name.trim(),
    description: input.description,
    hats: normaliseHats(input.hats),
    identity: normaliseIdentity(input.identity),
    model: { ...DEFAULT_MODEL, ...(input.model ?? {}) },
    limits: input.limits,
    tools: input.tools,
    scheduledActionIds: input.scheduledActionIds,
    tags: input.tags,
    revision: 1,
    createdAt: ts,
    updatedAt: ts,
  }) as AgentTemplate;
}

/** Apply a partial patch to an existing template, bumping the revision. */
export function patchAgentTemplate(current: AgentTemplate, patch: Partial<AgentTemplateInput>): AgentTemplate {
  const merged: AgentTemplate = {
    ...current,
    ...compact(patch as unknown as Record<string, unknown>),
    ...(patch.name !== undefined && { name: patch.name.trim() }),
    ...(patch.hats !== undefined && { hats: normaliseHats(patch.hats) }),
    ...(patch.identity !== undefined && { identity: normaliseIdentity({ ...current.identity, ...patch.identity }) }),
    ...(patch.model !== undefined && { model: { ...current.model, ...patch.model } }),
    id: current.id,
    schemaVersion: SCHEMA_VERSION,
    revision: current.revision + 1,
    createdAt: current.createdAt,
    updatedAt: nowIso(),
  };
  // An explicit null in the patch clears the optional field entirely.
  const mutable = merged as unknown as Record<string, unknown>;
  for (const key of ['limits', 'tools', 'scheduledActionIds', 'tags', 'description'] as const) {
    if (patch[key] === null) delete mutable[key];
  }
  return merged;
}

/**
 * Replace a template wholesale, keeping only its identity and history.
 *
 * Unlike `patchAgentTemplate`, a field absent from the input is *removed* — that
 * is what makes PUT a replace. Clearing an optional field such as an MCP
 * allow-list is impossible otherwise.
 */
export function replaceAgentTemplate(current: AgentTemplate, input: AgentTemplateInput): AgentTemplate {
  const replaced = createAgentTemplate(input, current.id);
  return {
    ...replaced,
    revision: current.revision + 1,
    createdAt: current.createdAt,
    updatedAt: nowIso(),
  };
}

export interface DeployOptions {
  instanceId?: string;
  name?: string;
  projectRole?: string;
  enabled?: boolean;
}

/** Resolve a library template into a project-local deployed agent. */
export function deployTemplate(template: AgentTemplate, options: DeployOptions = {}): DeployedAgent {
  return compact({
    schemaVersion: SCHEMA_VERSION,
    instanceId: options.instanceId ?? randomUUID(),
    templateId: template.id,
    templateRevision: template.revision,
    name: (options.name ?? template.name).trim(),
    hats: normaliseHats(template.hats),
    identity: normaliseIdentity(template.identity),
    model: { ...template.model },
    limits: template.limits,
    tools: template.tools,
    scheduledActionIds: template.scheduledActionIds,
    enabled: options.enabled ?? true,
    projectRole: options.projectRole,
    deployedAt: nowIso(),
  }) as DeployedAgent;
}

/** Build a deployed agent that has no library template behind it. */
export function createDeployedAgent(input: Partial<DeployedAgent> & { name: string }): DeployedAgent {
  return compact({
    schemaVersion: SCHEMA_VERSION,
    instanceId: input.instanceId ?? randomUUID(),
    templateId: input.templateId,
    templateRevision: input.templateRevision,
    name: input.name.trim(),
    hats: normaliseHats(input.hats),
    identity: normaliseIdentity(input.identity),
    model: { ...DEFAULT_MODEL, ...(input.model ?? {}) },
    limits: input.limits,
    tools: input.tools,
    scheduledActionIds: input.scheduledActionIds,
    enabled: input.enabled ?? true,
    projectRole: input.projectRole,
    home: input.home,
    needs: input.needs,
    teamContext: input.teamContext,
    deployedAt: input.deployedAt ?? nowIso(),
  }) as DeployedAgent;
}

export interface CreateProjectInput {
  id: string;
  name?: string;
  description?: string;
  goal?: string;
  humanName?: string;
  team?: DeployedAgent[];
  mcpServers?: ProjectDefinition['mcpServers'];
  settings?: ProjectDefinition['settings'];
}

export function createProject(input: CreateProjectInput): ProjectDefinition {
  const ts = nowIso();
  return compact({
    schemaVersion: SCHEMA_VERSION,
    id: input.id,
    name: (input.name ?? input.id).trim(),
    description: input.description,
    goal: input.goal,
    humanName: (input.humanName ?? 'Human').trim() || 'Human',
    team: input.team ?? [],
    mcpServers: input.mcpServers,
    settings: input.settings,
    revision: 1,
    createdAt: ts,
    updatedAt: ts,
  }) as ProjectDefinition;
}

/** Merge an incoming definition over the stored one, preserving identity and bumping revision. */
export function reviseProject(current: ProjectDefinition, next: Partial<ProjectDefinition>): ProjectDefinition {
  return {
    ...current,
    ...compact(next as Record<string, unknown>),
    // `compact` drops empty arrays, but for these two an empty list is an
    // instruction, not an omission: a team with nobody on it, and a project
    // that runs no shared MCP servers. Without this, unticking the last server
    // in the Designer silently left it enabled.
    ...(next.team !== undefined && { team: next.team }),
    ...(next.mcpServers !== undefined && { mcpServers: next.mcpServers }),
    schemaVersion: SCHEMA_VERSION,
    id: current.id,
    revision: current.revision + 1,
    createdAt: current.createdAt,
    updatedAt: nowIso(),
  };
}

export function summariseProject(project: ProjectDefinition, active: boolean): ProjectSummary {
  return compact({
    id: project.id,
    name: project.name,
    goal: project.goal,
    description: project.description,
    teamSize: project.team.length,
    revision: project.revision,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    active,
  }) as ProjectSummary;
}

/**
 * Valid project ids, matching `slug` in common.schema.json.
 *
 * A project id doubles as a folder name, so path separators and dots are
 * excluded; spaces and capitals are allowed because existing project folders
 * use them and an id must be able to name one.
 */
export const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/;

export const isValidProjectId = (id: string): boolean => PROJECT_ID_PATTERN.test(id);

/** Turn arbitrary user text into a valid project id. New ids are kept tidy. */
export function slugifyProjectId(input: string): string {
  const slug = input.trim().toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return /^[a-z0-9]/.test(slug) ? slug : `p-${slug}`.slice(0, 64);
}
