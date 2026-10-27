import { describe, it, expect } from 'vitest';
import { Agent } from './agent.js';
import { HatType } from '../../../packages/core/src/hats/types.js';
import { MockProvider } from '../providers/mock.js';
import type { AgentConfig } from './types.js';

function makeAgent(provider: MockProvider, overrides: Partial<AgentConfig> = {}): Agent {
  return new Agent({
    identity: { name: 'Poppy', visualDescription: 'An assistant.' },
    hatType: [HatType.Blue], provider, model: 'mock-model', ...overrides,
  });
}

async function promptSent(agent: Agent, provider: MockProvider): Promise<string> {
  agent.receive({ id: 'm', ts: new Date().toISOString(), type: 'direct', from: 'human', to: 'Poppy', content: 'Hi' });
  await new Promise((r) => setTimeout(r, 50));
  return provider.calls.at(-1)?.systemPrompt ?? '';
}

describe('which prompt an agent is given', () => {
  it('is the full one by default', async () => {
    const provider = new MockProvider({ content: 'ok' });
    const agent = makeAgent(provider);
    expect(await promptSent(agent, provider)).toBe(agent.previewPrompt().text);
  });

  it('is the condensed one when set, and its extra instructions are in it', async () => {
    const provider = new MockProvider({ content: 'ok' });
    const agent = makeAgent(provider);
    agent.setPromptSettings('Reply in French.', 'condensed');
    const sent = await promptSent(agent, provider);
    expect(sent).toBe(agent.previewPrompt().condensed);
    expect(sent).toContain('Reply in French.');
  });

  it('previews unsaved instructions without changing what the agent is given', () => {
    const agent = makeAgent(new MockProvider({ content: 'ok' }), { instructions: 'Saved.' });
    expect(agent.previewPrompt({ instructions: 'Draft.' }).text).toContain('Draft.');
    expect(agent.previewPrompt().text).toContain('Saved.');
  });
});
