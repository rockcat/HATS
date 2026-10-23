/**
 * Rendering the system prompt a template would produce.
 *
 * Reuses the Team Runner's prompt generator so the library shows exactly what
 * the runner will build — one generator, no second implementation to drift.
 *
 * Works from partial input as well as a stored template, because the editor
 * re-renders the prompt live while the user is still typing.
 */

import { mergeHatDefinitions } from '../../../packages/core/src/hats/definitions.js';
import { generateSystemPrompt } from '../../../packages/core/src/prompt/generator.js';
import type { HatType } from '../../../packages/core/src/hats/types.js';
import type { AgentTemplate, AgentTemplateInput, HatTypeName } from '../../../packages/contracts/src/types.js';

type PromptSource = AgentTemplate | AgentTemplateInput;

export function renderTemplatePrompt(template: PromptSource): string {
  const hats = (template.hats?.length ? template.hats : ['none']) as HatTypeName[];
  const hat = mergeHatDefinitions(hats as unknown as HatType[]);
  const identity = template.identity ?? {};

  const prompt = generateSystemPrompt({
    name: template.name?.trim() || 'Agent',
    visualDescription: identity.visualDescription ?? '',
    backstory: identity.backstory,
    specialisation: identity.specialisation,
    email: identity.email,
    hatLabel: hat.label,
    thinkingStyle: hat.thinkingStyle,
    communicationTone: hat.communicationTone,
    directives: hat.directives,
    avoidances: hat.avoidances,
    teamRole: hat.teamRole,
  });
  return prompt.text;
}
