import { describe, it, expect } from 'vitest';
import { generateSystemPrompt } from './generator.js';
import { PromptContext } from './types.js';

const baseContext: PromptContext = {
  name: 'Alex',
  visualDescription: 'A serious-looking analyst with sharp eyes.',
  hatLabel: 'Black Hat',
  thinkingStyle: 'You think critically about risks.',
  communicationTone: 'Direct and evidence-based.',
  directives: ['Identify risks in every plan.', 'Stress-test assumptions.'],
  avoidances: ['Do not block progress.', 'Do not catastrophise.'],
  teamRole: 'Risk officer.',
};

describe('generateSystemPrompt', () => {
  it('includes all 8 sections when teamContext is provided', () => {
    const ctx: PromptContext = { ...baseContext, teamContext: 'You are part of Team Alpha.' };
    const result = generateSystemPrompt(ctx);
    expect(result.sections.identityAnchor).toBeTruthy();
    expect(result.sections.hatRoleStatement).toBeTruthy();
    expect(result.sections.thinkingStyle).toBeTruthy();
    expect(result.sections.communicationTone).toBeTruthy();
    expect(result.sections.directives).toBeTruthy();
    expect(result.sections.avoidances).toBeTruthy();
    expect(result.sections.teamRole).toBeTruthy();
    expect(result.sections.closingAnchor).toBeTruthy();
  });

  it('omits teamRole section when no teamContext', () => {
    const result = generateSystemPrompt(baseContext);
    expect(result.sections.teamRole).toBeUndefined();
    expect(result.text).not.toContain('Your team context');
  });

  it('includes closing anchor with agent name', () => {
    const result = generateSystemPrompt(baseContext);
    expect(result.sections.closingAnchor).toContain('Alex');
    expect(result.text).toContain('Stay fully in character as Alex at all times.');
  });

  it('includes identity anchor with name and description', () => {
    const result = generateSystemPrompt(baseContext);
    expect(result.sections.identityAnchor).toContain('Alex');
    expect(result.sections.identityAnchor).toContain('serious-looking analyst');
  });

  it('includes backstory when provided', () => {
    const ctx: PromptContext = { ...baseContext, backstory: 'Former hedge fund manager.' };
    const result = generateSystemPrompt(ctx);
    expect(result.sections.identityAnchor).toContain('Former hedge fund manager.');
  });

  it('injects teamContext into team role section', () => {
    const ctx: PromptContext = { ...baseContext, teamContext: 'You are part of Team Alpha.' };
    const result = generateSystemPrompt(ctx);
    expect(result.sections.teamRole).toContain('Team Alpha');
  });

  it('all directives appear in text', () => {
    const result = generateSystemPrompt(baseContext);
    for (const directive of baseContext.directives) {
      expect(result.text).toContain(directive);
    }
  });
});
