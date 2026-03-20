import { describe, it, expect } from 'vitest';
import { Agent } from './agent.js';
import { AgentState } from './types.js';
import { HatType } from '../hats/types.js';
import { MockProvider } from '../providers/mock.js';
import { TeamMessage } from '../orchestrator/types.js';

function makeAgent(overrides: Partial<ConstructorParameters<typeof Agent>[0]> = {}): Agent {
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

function makeTaskMessage(content = 'Review this proposal.'): TeamMessage {
  return {
    id: 'msg-1',
    ts: new Date().toISOString(),
    type: 'task',
    from: 'human',
    to: 'TestAgent',
    content,
  };
}

function makeDirectMessage(content = 'Hello.', from = 'human'): TeamMessage {
  return {
    id: 'msg-2',
    ts: new Date().toISOString(),
    type: 'direct',
    from,
    to: 'TestAgent',
    content,
  };
}

async function waitForProcessing(): Promise<void> {
  // Let the async inbox processing settle
  await new Promise((r) => setTimeout(r, 50));
}

describe('Agent', () => {
  it('starts in Idle state', () => {
    const agent = makeAgent();
    expect(agent.state).toBe(AgentState.Idle);
  });

  it('transitions to Working when a task message is received', async () => {
    const agent = makeAgent();
    agent.receive(makeTaskMessage());
    await waitForProcessing();
    expect(agent.state).toBe(AgentState.Working);
  });

  it('transitions to WaitingForHelp on markBlocked', async () => {
    const agent = makeAgent();
    agent.receive(makeTaskMessage());
    await waitForProcessing();
    agent.markBlocked();
    expect(agent.state).toBe(AgentState.WaitingForHelp);
  });

  it('transitions to InDiscussion on meeting invite', async () => {
    const agent = makeAgent();
    agent.receive(makeTaskMessage());
    await waitForProcessing();
    const invite: TeamMessage = { ...makeDirectMessage(), type: 'meeting_invite' };
    agent.receive(invite);
    await waitForProcessing();
    expect(agent.state).toBe(AgentState.InDiscussion);
  });

  it('sends system prompt containing agent name to provider', async () => {
    const provider = new MockProvider({ content: 'ok' });
    const agent = new Agent({
      identity: { name: 'Alex', visualDescription: 'Sharp analyst.' },
      hatType: HatType.Black,
      provider,
      model: 'mock-model',
    });
    agent.receive(makeDirectMessage('Hello', 'human'));
    await waitForProcessing();
    expect(provider.calls[0]?.systemPrompt).toContain('Alex');
  });

  it('system prompt contains hat label', async () => {
    const provider = new MockProvider({ content: 'ok' });
    const agent = new Agent({
      identity: { name: 'Alex', visualDescription: 'Sharp analyst.' },
      hatType: HatType.Black,
      provider,
      model: 'mock-model',
    });
    agent.receive(makeDirectMessage('Hello', 'human'));
    await waitForProcessing();
    expect(provider.calls[0]?.systemPrompt).toContain('Black Hat');
  });

  it('injects teamContext into system prompt', async () => {
    const provider = new MockProvider({ content: 'ok' });
    const agent = new Agent({
      identity: { name: 'Alex', visualDescription: 'Sharp analyst.' },
      hatType: HatType.Black,
      provider,
      model: 'mock-model',
      teamContext: 'You are part of Team Alpha.',
    });
    agent.receive(makeDirectMessage('Hello', 'human'));
    await waitForProcessing();
    expect(provider.calls[0]?.systemPrompt).toContain('Team Alpha');
  });

  it('toJSON returns expected shape', () => {
    const agent = makeAgent();
    const json = agent.toJSON() as Record<string, unknown>;
    expect(json['id']).toBeTruthy();
    expect(json['name']).toBe('TestAgent');
    expect(json['hatType']).toBe(HatType.Black);
    expect(json['state']).toBe(AgentState.Idle);
  });

  it('executes tool calls via toolExecutor', async () => {
    const toolResults: string[] = [];
    const provider = new MockProvider([
      {
        content: '',
        toolCalls: [{ id: 'tc1', name: 'send_message', arguments: { to: 'Bob', message: 'Hi' } }],
      },
      { content: 'Done.' },
    ]);
    const agent = makeAgent({ provider });
    agent.setToolExecutor(async (_name, call) => {
      toolResults.push(call.name);
      return 'ok';
    });
    agent.setResponseHandler(async () => {});
    agent.receive(makeDirectMessage('Say hi to Bob'));
    await waitForProcessing();
    expect(toolResults).toContain('send_message');
  });
});
