import { describe, it, expect } from 'vitest';
import { generateSystemPrompt } from './generator.js';
import { mergeHatDefinitions } from '../hats/definitions.js';
import { HatType } from '../hats/types.js';
import type { PromptContext } from './types.js';

function contextFor(hats: HatType[], extra: Partial<PromptContext> = {}): PromptContext {
  const hat = mergeHatDefinitions(hats);
  return {
    name: 'Poppy',
    visualDescription: 'A cheerful assistant in a yellow raincoat.',
    backstory: 'Poppy keeps the household running.',
    hatLabel: hat.label,
    coreTrait: hat.coreTrait,
    thinkingStyle: hat.thinkingStyle,
    communicationTone: hat.communicationTone,
    directives: hat.directives,
    avoidances: hat.avoidances,
    teamRole: hat.teamRole,
    specialisation: 'Personal Assistant',
    email: 'poppy@example.com',
    projectGoal: 'Keep the inbox at zero.',
    hasTicketing: true,
    ...extra,
  };
}

describe('the condensed prompt', () => {
  it('is generated alongside the full one, and is well under half its size', () => {
    for (const hats of [[HatType.Blue], [HatType.White, HatType.Black], [HatType.None]]) {
      const prompt = generateSystemPrompt(contextFor(hats));
      expect(prompt.condensed.length).toBeGreaterThan(0);
      expect(prompt.condensed.length).toBeLessThan(prompt.text.length / 2);
    }
  });

  it('keeps who the agent is, its hat, its goal, and its tools', () => {
    const { condensed } = generateSystemPrompt(contextFor([HatType.Black]));
    expect(condensed).toContain('You are Poppy, Personal Assistant specialist.');
    expect(condensed).toContain('Poppy keeps the household running.');
    expect(condensed).toContain('Black Hat');
    expect(condensed).toContain('Goal: Keep the inbox at zero.');
    expect(condensed).toContain('poppy@example.com');
    expect(condensed).toContain('list_tickets');
    expect(condensed).toContain('write_file');
  });

  it('leaves out the board when the agent has none, and the team when there is none', () => {
    const { condensed } = generateSystemPrompt(contextFor([HatType.Blue], { hasTicketing: false }));
    expect(condensed).not.toContain('list_tickets');
    expect(condensed).not.toContain('Team:');
  });

  it('keeps the team roster — the agent needs to know who it can talk to', () => {
    const { condensed } = generateSystemPrompt(contextFor([HatType.Blue], { teamContext: 'Dave (White Hat), Priya (Red Hat)' }));
    expect(condensed).toContain('Dave (White Hat), Priya (Red Hat)');
  });
});

describe('extra instructions', () => {
  it('go into both prompts, as written', () => {
    const instructions = 'Always sign emails "— Poppy, for Paul".';
    const prompt = generateSystemPrompt(contextFor([HatType.Blue], { instructions }));
    expect(prompt.text).toContain(`## Additional instructions\n\n${instructions}`);
    expect(prompt.sections.instructions).toContain(instructions);
    expect(prompt.condensed).toContain(instructions);
  });

  it('add nothing when blank', () => {
    const prompt = generateSystemPrompt(contextFor([HatType.Blue], { instructions: '   ' }));
    expect(prompt.text).not.toContain('Additional instructions');
    expect(prompt.sections.instructions).toBeUndefined();
  });
});
