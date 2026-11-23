/**
 * TypeScript mirrors of the HATS JSON Schemas.
 *
 * These types are the compile-time half of the contract; `schemas/*.schema.json`
 * is the runtime half. Both are validated against each other by
 * `packages/contracts/src/contracts.test.ts` — change one, change the other.
 */

export const SCHEMA_VERSION = 1 as const;

export type HatTypeName = 'none' | 'white' | 'red' | 'black' | 'yellow' | 'green' | 'blue';

export const HAT_TYPE_NAMES: readonly HatTypeName[] = [
  'none', 'white', 'red', 'black', 'yellow', 'green', 'blue',
];

/** `external` delegates the agent to an out-of-process runner such as Claude Code. */
export type ProviderName =
  'anthropic' | 'openai' | 'gemini' | 'ollama' | 'lmstudio' | 'external' | 'mock';

export const PROVIDER_NAMES: readonly ProviderName[] = [
  'anthropic', 'openai', 'gemini', 'ollama', 'lmstudio', 'external', 'mock',
];

export interface AgentIdentitySpec {
  visualDescription: string;
  specialisation?: string;
  backstory?: string;
  email?: string;
  avatar?: string;
  background?: string;
  voice?: string;
  speakerName?: string;
}

export interface ModelBinding {
  provider: ProviderName;
  model: string;
}

/** How to reach an agent whose provider is `external`. Passed through verbatim. */
export interface ExternalEndpoint {
  mode: 'subprocess' | 'http';
  command?: string;
  args?: string[];
  inputMode?: string;
  url?: string;
  timeoutMs?: number;
  [key: string]: unknown;
}

export interface AgentLimits {
  maxContextTokens?: number;
  maxCostPerHour?: number;
}

export interface ToolAccess {
  enabledMcpServers?: string[];
  disabledPersonalMcpServers?: string[];
  /**
   * Which MCP tools the model is shown in every call, instead of having to
   * find them with `search_tools`.
   *
   * An entry is a server id — `email-imap`, meaning all of its tools — or
   * one tool, `email-imap:get_email`. Absent means every personal server,
   * because an agent given its own mailbox should not have to discover it.
   * An empty list means nothing is sent upfront and everything is searched
   * for, which is the cheapest option for a server with many tools.
   */
  upfrontTools?: string[];
}

export interface McpServerDefinition {
  name: string;
  config: {
    transport: 'stdio' | 'http' | 'sse';
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
    [key: string]: unknown;
  };
}

/** A reusable, project-independent agent definition held in the Agent Template Library. */
export interface AgentTemplate {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  name: string;
  description?: string;
  hats: HatTypeName[];
  identity: AgentIdentitySpec;
  model: ModelBinding;
  externalEndpoint?: ExternalEndpoint;
  limits?: AgentLimits;
  tools?: ToolAccess;
  scheduledActionIds?: string[];
  tags?: string[];
  revision: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Fields a client may supply when creating or updating a template.
 * `identity` is partial here because a PATCH may carry a single field —
 * the factories fill in the required parts.
 */
export type AgentTemplateInput =
  Partial<Omit<AgentTemplate, 'schemaVersion' | 'id' | 'revision' | 'createdAt' | 'updatedAt' | 'identity'>>
  & Pick<AgentTemplate, 'name'>
  & { identity?: Partial<AgentIdentitySpec> };

/** An agent as deployed into one project — fully resolved, no library lookup needed. */
export interface DeployedAgent {
  schemaVersion: typeof SCHEMA_VERSION;
  instanceId: string;
  templateId?: string;
  templateRevision?: number;
  name: string;
  hats: HatTypeName[];
  identity: AgentIdentitySpec;
  model: ModelBinding;
  externalEndpoint?: ExternalEndpoint;
  limits?: AgentLimits;
  tools?: ToolAccess;
  scheduledActionIds?: string[];
  enabled: boolean;
  projectRole?: string;
  /**
   * The project this agent belongs to. Absent means the project holding it;
   * it differs only while the agent visits another team. Read it with
   * `homeOf`, never directly.
   */
  home?: string;
  teamContext?: string;
  deployedAt: string;
}

/** Which teams a team's agents may visit, and which teams' agents it hosts. */
export interface VisitPolicy {
  /** Teams this team's agents may visit; "*" is any team in the installation. */
  visitTo?: string[];
  /** Teams whose agents this team hosts; "*" is any team in the installation. */
  hostFrom?: string[];
  /** Whether an allowed visit here goes ahead, or waits for an admin. Default "admin". */
  approval?: 'auto' | 'admin';
  /** The longest a visit out of this team, or into it, may last. */
  maxHours?: number;
  /** What visitors take home from this team. Default "summary". */
  memoryHome?: 'all' | 'summary' | 'none';
}

export interface ProjectSettings {
  speechEnabled?: boolean;
  autoAssignVisuals?: boolean;
  defaultMeetingType?: 'standup' | 'sprint_planning' | 'retro' | 'review' | 'ad_hoc';
  /** One or two sentences for other teams finding this one. Defaults to the goal. */
  summary?: string;
  /** What this team works on, for other teams finding it. */
  tags?: string[];
  visits?: VisitPolicy;
}

/** The portable description of a project: objective, team and shared tools. */
export interface ProjectDefinition {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  name: string;
  description?: string;
  goal?: string;
  humanName: string;
  team: DeployedAgent[];
  mcpServers?: McpServerDefinition[];
  settings?: ProjectSettings;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * One event on the Project Server's stream, GET /api/v1/events: a project was
 * saved, with its new revision, or removed. Enough to fetch it again.
 */
export type ProjectChange =
  | { type: 'project_changed'; id: string; revision: number }
  | { type: 'project_removed'; id: string };

/** Listing entry returned by the Project Server — the definition without the team. */
export interface ProjectSummary {
  id: string;
  name: string;
  goal?: string;
  description?: string;
  teamSize: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
  active: boolean;
}

export interface ApiErrorDetail {
  path: string;
  message: string;
}

export interface ApiError {
  error: string;
  code?: string;
  details?: ApiErrorDetail[];
}

// ── Embodiment API payloads ───────────────────────────────────────────────────

export type EmbodiedAgentState =
  | 'idle' | 'working' | 'waiting' | 'waiting_for_help' | 'in_discussion';

/**
 * How to frame the agent's avatar model. Mirrors the runner's avatar
 * catalogue: without it a client can download the model but has no idea where
 * to put the camera, which is the difference between a face and a nostril.
 */
export interface AvatarFraming {
  /** Camera position, `[x, y, z]` in metres. */
  camera?: [number, number, number];
  /** Model rotation, `[x, y, z]` in degrees. */
  rotate?: [number, number, number];
  /** Vertical field of view in degrees. */
  fov?: number;
  /** Uniform scale applied to the model. */
  scale?: number;
}

/** How an agent appears to a client of the Embodiment API. */
export interface EmbodiedAgent {
  id: string;
  /** The Agent Template Library template this instance was deployed from, if any. */
  templateId?: string;
  name: string;
  hats: HatTypeName[];
  state: EmbodiedAgentState;
  activity: string;
  talkingTo?: string;
  model: ModelBinding;
  identity: AgentIdentitySpec;
  threads: Record<string, number>;
  hourlyCost: number;
  costIdled: boolean;
  hasVoice: boolean;
  hasAvatar: boolean;
  /** Absent when the agent has no avatar, or none the runner can frame. */
  appearance?: AvatarFraming;
}

export interface EmbodimentMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: string;
  toolName?: string;
}

export interface SendMessageRequest {
  content: string;
  thread?: string;
  /** 'chat' waits for nothing; 'task' assigns durable work tracked on the board. */
  mode?: 'chat' | 'task';
  context?: string;
}

export interface SendMessageResponse {
  accepted: true;
  agentId: string;
  thread: string;
  messageId: string;
}

export interface EmbodimentProjectInfo {
  id: string;
  name: string;
  goal: string;
  humanName: string;
  source: 'project-server' | 'local';
  agentCount: number;
}
