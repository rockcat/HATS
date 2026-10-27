/**
 * Agents as they are inside one project.
 *
 * A library template is where an agent starts, not where it lives. Adding one
 * to a project makes a copy with its own id, and from then on the copy is
 * tailored in that project — the template and the other projects' copies do
 * not move with it.
 */

import { randomUUID } from 'crypto';
import type { AgentConfig } from '../agent/types.js';
import type { AIProvider } from '../providers/types.js';
import type { AgentDefinition } from '../store/team-snapshot.js';
import type { AgendaStore } from './agenda-store.js';
import type { ScheduledActionStore } from './scheduled-action-store.js';
import { planAssignment, applyAssignment } from './agenda-sync.js';

/** A template's settings as a new project agent, linked back to it by templateId. */
export function projectCopy(template: AgentDefinition, provider: AIProvider, id: string = randomUUID()): AgentConfig {
  return {
    id,
    templateId: template.id,
    identity: { ...template.identity },
    hatType: [...template.hatType],
    provider,
    model: template.model,
    enabledMcpServers: template.enabledMcpServers && [...template.enabledMcpServers],
    disabledPersonalMcpServers: template.disabledPersonalMcpServers && [...template.disabledPersonalMcpServers],
    personalMcpCredentials: template.personalMcpCredentials,
    maxContextTokens: template.maxContextTokens,
    maxCostPerHour: template.maxCostPerHour,
    externalEndpoint: template.externalEndpoint,
  };
}

/**
 * Whether a project already has an agent from this template. Agents added
 * before copies had their own id carry the template's id instead.
 */
export function hasCopyOf(running: { id: string; config: { templateId?: string } }[], templateId: string): boolean {
  return running.some(a => a.id === templateId || a.config.templateId === templateId);
}

/** Make one project agent's agenda hold exactly these scheduled actions. */
export async function assignScheduledActions(
  agenda: AgendaStore | null,
  actions: ScheduledActionStore | null,
  agentName: string,
  actionIds: string[],
): Promise<void> {
  if (!agenda || !actions) return;
  await applyAssignment(agenda, agentName, planAssignment(agenda.list(agentName), actions.list(), actionIds));
}
