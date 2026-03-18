import { describe, it, expect, beforeEach } from 'vitest';
import { Agent } from './agent.js';
import { AgentState } from './types.js';
import { HatType } from '../hats/types.js';
import { MockProvider } from '../providers/mock.js';

function makeAgent(overrides?: Partial<Parameters<typeof Agent>[0]>): Agent {
  return new Agent({
    identity: {
      name: 'TestAgent',
      visualDescription: 'A test agent.',
    },
    hatType: HatType.Black,
    provider: new MockProvider({ content: 'This plan has three critical risks.' }),
    model: 'mock-model',
    ...overrides,
  });
}

describe('Agent', () => {
  it('starts in Idle state', () => {
    const agent = makeAgent();
    expect(agent.state).toBe(AgentState.Idle);
  });

  it('transitions to Working when chat is called from Idle', async () => {
    const agent = makeAgent();
    await agent.chat('Review this proposal.');
    expect(agent.state).toBe(AgentState.Working);
  });

  it('returns provider response from chat', async () => {
    const agent = makeAgent();
    const response = await agent.chat('Review this proposal.');
    expect(response).toBe('This plan has three critical risks.');
  });

  it('transitions to WaitingForHelp on requestHelp', async () => {
    const agent = makeAgent();
    await agent.chat('Start task.');
    agent.requestHelp();
    expect(agent.state).toBe(AgentState.WaitingForHelp);
  });

  it('transitions to InDiscussion on joinDiscussion', async () => {
    const agent = makeAgent();
    await agent.chat('Start task.');
    agent.joinDiscussion();
    expect(agent.state).toBe(AgentState.InDiscussion);
  });

  it('sends system prompt to provider', async () => {
    const provider = new MockProvider({ content: 'ok' });
    const agent = new Agent({
      identity: { name: 'Alex', visualDescription: 'Sharp analyst.' },
      hatType: HatType.Black,
      provider,
      model: 'mock-model',
    });
    await agent.chat('Hello');
    expect(provider.calls[0]?.systemPrompt).toContain('Alex');
    expect(provider.calls[0]?.systemPrompt).toContain('Black Hat');
  });

  it('toJSON returns expected shape', () => {
    const agent = makeAgent();
    const json = agent.toJSON() as Record<string, unknown>;
    expect(json.id).toBeTruthy();
    expect(json.name).toBe('TestAgent');
    expect(json.hatType).toBe(HatType.Black);
    expect(json.state).toBe(AgentState.Idle);
  });

  it('injects teamContext into system prompt when provided', async () => {
    const provider = new MockProvider({ content: 'ok' });
    const agent = new Agent({
      identity: { name: 'Alex', visualDescription: 'Sharp analyst.' },
      hatType: HatType.Black,
      provider,
      model: 'mock-model',
      teamContext: 'You are part of Team Alpha.',
    });
    await agent.chat('Hello');
    expect(provider.calls[0]?.systemPrompt).toContain('Team Alpha');
  });
});
