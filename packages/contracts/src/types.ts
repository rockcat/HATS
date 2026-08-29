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

export type ProviderName = 'anthropic' | 'openai' | 'gemini' | 'ollama' | 'lmstudio' | 'mock';

export const PROVIDER_NAMES: readonly ProviderName[] = [
  'anthropic', 'openai', 'gemini', 'ollama', 'lmstudio', 'mock',
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

export interface AgentLimits {
  maxContextTokens?: number;
  maxCostPerHour?: number;
}

export interface ToolAccess {
  enabledMcpServers?: string[];
  disabledPersonalMcpServers?: string[];
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

/** A reusable, project-independent agent definition held in the Agent Library. */
export interface AgentTemplate {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  name: string;
  description?: string;
  hats: HatTypeName[];
  identity: AgentIdentitySpec;
  model: ModelBinding;
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
  limits?: AgentLimits;
  tools?: ToolAccess;
  scheduledActionIds?: string[];
  enabled: boolean;
  projectRole?: string;
  teamContext?: string;
  deployedAt: string;
}

export interface ProjectSettings {
  speechEnabled?: boolean;
  autoAssignVisuals?: boolean;
  defaultMeetingType?: 'standup' | 'sprint_planning' | 'retro' | 'review' | 'ad_hoc';
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

/** How an agent appears to a client of the Embodiment API. */
export interface EmbodiedAgent {
  id: string;
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
