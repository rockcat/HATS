/**
 * Rendering the system prompt a template would produce.
 *
 * Reuses the Team Runner's prompt generator so the library shows exactly what
 * the runner will build — one generator, no second implementation to drift.
 */

import { mergeHatDefinitions } from '../../../src/hats/definitions.js';
import { generateSystemPrompt } from '../../../src/prompt/generator.js';
import type { HatType } from '../../../src/hats/types.js';
import type { AgentTemplate } from '../../../packages/contracts/src/types.js';

export function renderTemplatePrompt(template: AgentTemplate): string {
  const hat = mergeHatDefinitions(template.hats as unknown as HatType[]);
  const prompt = generateSystemPrompt({
    name: template.name,
    visualDescription: template.identity.visualDescription,
    backstory: template.identity.backstory,
    specialisation: template.identity.specialisation,
    email: template.identity.email,
    hatLabel: hat.label,
    thinkingStyle: hat.thinkingStyle,
    communicationTone: hat.communicationTone,
    directives: hat.directives,
    avoidances: hat.avoidances,
    teamRole: hat.teamRole,
  });
  return prompt.text;
}
