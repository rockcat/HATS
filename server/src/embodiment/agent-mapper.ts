/**
 * Translation between the runner's internal agent model and the contract types.
 *
 * The Embodiment API and the Project Server both speak the contract shapes; the
 * orchestrator speaks `AgentConfig`. Every conversion between the two lives
 * here so the mapping is defined exactly once.
 */

import type { IAgent } from '../agent/iagent.js';
import type { AgentConfig } from '../agent/types.js';
import type { AIProvider } from '../providers/types.js';
import type { HatType } from '../../../packages/core/src/hats/types.js';
import { createDeployedAgent } from '../../../packages/contracts/src/factories.js';
import type {
  AvatarFraming,
  DeployedAgent,
  EmbodiedAgent,
  EmbodiedAgentState,
  HatTypeName,
  ProviderName,
} from '../../../packages/contracts/src/types.js';

/** Drop undefined values so the result satisfies exactOptionalPropertyTypes-style schemas. */
function compact<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== '')) as T;
}

/**
 * A running agent as the Embodiment API presents it.
 *
 * `appearance` carries the avatar framing from the runner's catalogue. A
 * client that can only see the model file has no way to work out where the
 * camera goes, so the runner hands it over with the roster.
 */
export function toEmbodiedAgent(
  agent: IAgent,
  activity: { activity: string; talkingTo?: string } | undefined,
  appearance?: AvatarFraming,
): EmbodiedAgent {
  const identity = agent.config.identity as typeof agent.config.identity & { background?: string };
  return compact({
    id: agent.id,
    templateId: agent.config.templateId,
    name: agent.name,
    hats: agent.hatType as unknown as HatTypeName[],
    state: agent.state as EmbodiedAgentState,
    activity: activity?.activity ?? agent.state,
    talkingTo: activity?.talkingTo,
    model: { provider: agent.config.provider.name as ProviderName, model: agent.config.model },
    identity: compact({
      visualDescription: identity.visualDescription,
      specialisation: identity.specialisation,
      backstory: identity.backstory,
      email: identity.email,
      avatar: identity.avatar,
      background: identity.background,
      voice: identity.voice,
      speakerName: identity.speakerName,
    }),
    threads: agent.getThreadSummary(),
    hourlyCost: agent.getHourlyCost(),
    costIdled: agent.isCostIdled(),
    hasVoice: Boolean(identity.voice),
    hasAvatar: Boolean(identity.avatar),
    ...(appearance && { appearance }),
  }) as EmbodiedAgent;
}

/** A running agent captured as a project-server deployed agent document. */
export function toDeployedAgent(agent: IAgent, existing?: DeployedAgent): DeployedAgent {
  const identity = agent.config.identity as typeof agent.config.identity & { background?: string };
  return createDeployedAgent({
    ...(existing ?? {}),
    instanceId: agent.id,
    ...(agent.config.templateId && { templateId: agent.config.templateId }),
    name: agent.name,
    hats: agent.hatType as unknown as HatTypeName[],
    identity: compact({
      visualDescription: identity.visualDescription,
      specialisation: identity.specialisation,
      backstory: identity.backstory,
      email: identity.email,
      avatar: identity.avatar,
      background: identity.background,
      voice: identity.voice,
      speakerName: identity.speakerName,
    }),
    model: { provider: agent.config.provider.name as ProviderName, model: agent.config.model },
    limits: compact({
      maxContextTokens: agent.config.maxContextTokens,
      maxCostPerHour: agent.config.maxCostPerHour,
    }),
    tools: compact({
      enabledMcpServers: agent.config.enabledMcpServers,
      disabledPersonalMcpServers: agent.config.disabledPersonalMcpServers,
      upfrontTools: agent.config.upfrontTools,
    }),
    enabled: true,
    ...(existing?.deployedAt && { deployedAt: existing.deployedAt }),
  });
}

/**
 * A project-server deployed agent turned into the config the orchestrator
 * registers. `resolveProvider` supplies the live provider adapter.
 *
 * `secrets` carries the per-agent MCP credentials the runner keeps locally.
 * They are deliberately absent from the deployed-agent contract — a project
 * definition is shared, and a credential is not — so they are re-attached here.
 */
export function toAgentConfig(
  deployed: DeployedAgent,
  resolveProvider: (name: string) => AIProvider,
  secrets: { personalMcpCredentials?: Record<string, Record<string, string>> } = {},
): AgentConfig {
  return compact({
    id: deployed.instanceId,
    templateId: deployed.templateId,
    identity: compact({
      name: deployed.name,
      visualDescription: deployed.identity.visualDescription,
      specialisation: deployed.identity.specialisation,
      backstory: deployed.identity.backstory,
      email: deployed.identity.email,
      avatar: deployed.identity.avatar,
      background: deployed.identity.background,
      voice: deployed.identity.voice,
      speakerName: deployed.identity.speakerName,
    }) as AgentConfig['identity'],
    hatType: deployed.hats as unknown as HatType[],
    provider: resolveProvider(deployed.model.provider),
    model: deployed.model.model,
    teamContext: deployed.teamContext,
    enabledMcpServers: deployed.tools?.enabledMcpServers,
    disabledPersonalMcpServers: deployed.tools?.disabledPersonalMcpServers,
    upfrontTools: deployed.tools?.upfrontTools,
    personalMcpCredentials: secrets.personalMcpCredentials,
    maxContextTokens: deployed.limits?.maxContextTokens,
    maxCostPerHour: deployed.limits?.maxCostPerHour,
  }) as AgentConfig;
}
