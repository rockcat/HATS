/**
 * What an agent's system prompt is built from.
 *
 * The agent builds its prompt from this, and so does the editor's preview, so
 * the preview shows what the agent is actually given.
 */

import { mergeHatDefinitions } from '../../../packages/core/src/hats/definitions.js';
import type { HatType } from '../../../packages/core/src/hats/types.js';
import type { PromptContext } from '../../../packages/core/src/prompt/types.js';
import type { AgentConfig } from './types.js';

/** Unsaved edits the preview shows before they are applied. */
export interface PromptOverrides {
  hatTypes?: HatType[];
  name?: string;
  specialisation?: string;
  instructions?: string;
}

export function promptContextFor(config: AgentConfig, hasTicketing: boolean, overrides: PromptOverrides = {}): PromptContext {
  const hat = mergeHatDefinitions(overrides.hatTypes?.length ? overrides.hatTypes : config.hatType);
  return {
    name: overrides.name ?? config.identity.name,
    visualDescription: config.identity.visualDescription,
    backstory: config.identity.backstory,
    hatLabel: hat.label,
    coreTrait: hat.coreTrait,
    thinkingStyle: hat.thinkingStyle,
    communicationTone: hat.communicationTone,
    directives: hat.directives,
    avoidances: hat.avoidances,
    teamRole: hat.teamRole,
    teamContext: config.teamContext,
    projectDir: config.projectDir,
    projectGoal: config.projectGoal,
    specialisation: overrides.specialisation !== undefined ? overrides.specialisation : config.identity.specialisation,
    email: config.identity.email,
    instructions: overrides.instructions !== undefined ? overrides.instructions : config.instructions,
    hasTicketing,
  };
}
