import { describe, it, expect } from 'vitest';
import { generateSystemPrompt } from './generator.js';
import { PromptContext } from './types.js';
import { mergeHatDefinitions } from '../hats/definitions.js';
import { HatType } from '../hats/types.js';

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

  it('includes specialisation in team role when set', () => {
    const ctx: PromptContext = { ...baseContext, teamContext: 'Team Alpha.', specialisation: 'Finance' };
    const result = generateSystemPrompt(ctx);
    expect(result.sections.teamRole).toContain('Finance');
    expect(result.text).toContain('Your current specialisation is **Finance**');
  });

  it('does not mention specialisation in team role when not set', () => {
    const ctx: PromptContext = { ...baseContext, teamContext: 'Team Alpha.' };
    const result = generateSystemPrompt(ctx);
    expect(result.sections.teamRole).not.toContain('specialisation');
  });

  it('all directives appear in text', () => {
    const result = generateSystemPrompt(baseContext);
    for (const directive of baseContext.directives) {
      expect(result.text).toContain(directive);
    }
  });
});

describe('wearing more than one hat', () => {
  const twoHats = () => generateSystemPrompt({
    ...baseContext,
    ...mergeHatDefinitions([HatType.Black, HatType.Yellow]),
    hatLabel: mergeHatDefinitions([HatType.Black, HatType.Yellow]).label,
  });

  it('tells the agent to answer once, not hat by hat', () => {
    // Replies were coming back as "**Black Hat**: … **Yellow Hat**: …", which
    // is the working out rather than the answer.
    const text = twoHats().text.toLowerCase();
    expect(text).toContain('do not label sections of your reply by hat');
  });

  it('no longer asks for a label per perspective', () => {
    const text = twoHats().text;
    expect(text).not.toContain('using the hat name as a label');
    expect(text).not.toMatch(/Label each hat.s perspective explicitly/);
  });

  it('still applies every hat, which is the point of wearing them', () => {
    const text = twoHats().text.toLowerCase();
    expect(text).toContain('apply every one of your hats');
    expect(text).toContain('black hat');  // named once, as the role
  });

  it('keeps a genuine disagreement visible rather than averaging it away', () => {
    const text = twoHats().text.toLowerCase();
    expect(text).toContain('conflict');
  });
});

describe('tracking work on the board', () => {
  it('tells an agent with a board to raise a ticket for new work', () => {
    const text = generateSystemPrompt({ ...baseContext, hasTicketing: true }).text;
    expect(text).toContain('create_ticket');
    expect(text).toContain('Tracking work');
  });

  it('explains why, because an agent cannot tell it has forgotten', () => {
    const text = generateSystemPrompt({ ...baseContext, hasTicketing: true }).text;
    expect(text).toContain('you will not notice it has gone');
  });

  it('says nothing about tickets to an agent with no board', () => {
    // Telling it to raise a ticket it cannot raise teaches it that its tools
    // do not work.
    const text = generateSystemPrompt({ ...baseContext, hasTicketing: false }).text;
    expect(text).not.toContain('create_ticket');
    expect(text).not.toContain('Tracking work');
  });

  it('leaves it out when nobody said either way', () => {
    expect(generateSystemPrompt(baseContext).text).not.toContain('Tracking work');
  });
});
