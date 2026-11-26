import { describe, it, expect } from 'vitest';
import { isExternal, modelChange, spendText } from './agent-model.js';

const agent = { provider: 'anthropic', model: 'claude-sonnet-5-5', hourlyCost: 0.1234 };
const external = { provider: 'external', model: 'claude-code', hourlyCost: 0 };

describe("the Configure panel's model", () => {
  it('tells an external agent apart', () => {
    expect(isExternal(external)).toBe(true);
    expect(isExternal(agent)).toBe(false);
  });

  it("shows what the agent has spent this hour", () => {
    expect(spendText(agent)).toBe('$0.12 spent this hour');
    expect(spendText({ ...agent, hourlyCost: undefined })).toBe('');
    expect(spendText(external)).toBe('');
  });

  it('sends nothing when the model is unchanged', () => {
    expect(modelChange(agent, 'anthropic', 'claude-sonnet-5-5')).toBeNull();
    expect(modelChange(agent, 'anthropic', '  ')).toBeNull();
  });

  it('sends a new model or provider', () => {
    expect(modelChange(agent, 'anthropic', 'claude-opus-5-5 '))
      .toEqual({ provider: 'anthropic', model: 'claude-opus-5-5' });
    expect(modelChange(agent, 'ollama', 'llama4'))
      .toEqual({ provider: 'ollama', model: 'llama4' });
  });

  it('never changes an external agent', () => {
    expect(modelChange(external, 'anthropic', 'claude-opus-5-5')).toBeNull();
  });
});
