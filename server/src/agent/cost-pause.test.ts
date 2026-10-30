import { describe, it, expect } from 'vitest';
import { Agent } from './agent.js';
import { HatType } from '../../../packages/core/src/hats/types.js';
import { MockProvider } from '../providers/mock.js';

const settle = () => new Promise((r) => setTimeout(r, 50));

/** An agent that has already spent $1 this hour, against a $0.50 limit. */
function overBudget(provider: MockProvider): Agent {
  const agent = new Agent({
    identity: { name: 'Poppy', visualDescription: 'An assistant.' },
    hatType: [HatType.Blue], provider, model: 'mock-model', maxCostPerHour: 0.5,
  });
  (agent as unknown as { hourlyCost: number }).hourlyCost = 1;
  return agent;
}

function ask(agent: Agent): void {
  agent.receive({ id: 'm', ts: new Date().toISOString(), type: 'direct', from: 'human', to: 'Poppy', content: 'Hi' });
}

describe('an agent over its hourly budget', () => {
  it('holds a message, and says until when', async () => {
    const provider = new MockProvider({ content: 'ok' });
    const agent = overBudget(provider);
    ask(agent);
    await settle();

    expect(provider.calls).toHaveLength(0);
    expect(agent.isCostIdled()).toBe(true);
    const until = agent.getCostIdleUntil()!;
    expect(until).toBeGreaterThan(Date.now());
    expect(until).toBeLessThanOrEqual(Date.now() + 3_600_000);
    agent.stop();
  });

  it('answers it as soon as the limit is raised past what was spent', async () => {
    const provider = new MockProvider({ content: 'ok' });
    const agent = overBudget(provider);
    ask(agent);
    await settle();

    agent.setMaxCostPerHour(5);
    await settle();
    expect(provider.calls).toHaveLength(1);
    expect(agent.isCostIdled()).toBe(false);
    expect(agent.getCostIdleUntil()).toBeNull();
    agent.stop();
  });

  it('stays paused when the new limit is still below the spend', async () => {
    const provider = new MockProvider({ content: 'ok' });
    const agent = overBudget(provider);
    ask(agent);
    await settle();

    agent.setMaxCostPerHour(0.75);
    await settle();
    expect(provider.calls).toHaveLength(0);
    expect(agent.isCostIdled()).toBe(true);
    agent.stop();
  });
});
