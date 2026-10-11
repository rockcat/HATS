import { describe, it, expect } from 'vitest';
import { Agent } from './agent.js';
import { AgentState } from './types.js';
import { HatType } from '../hats/types.js';
import { MockProvider } from '../providers/mock.js';
import { TeamMessage } from '../orchestrator/types.js';
import { searchTools, getTool, buildToolRegistry } from '../tools/tool-search.js';
import { getAllToolsForHat, SEARCH_TOOLS, GET_TOOL } from '../tools/definitions.js';
import { splitToolSet } from '../tools/tool-exposure.js';

function makeAgent(overrides: Partial<ConstructorParameters<typeof Agent>[0]> = {}): Agent {
  return new Agent({
    identity: { name: 'TestAgent', visualDescription: 'A test agent.' },
    hatType: [HatType.Black],
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
    expect(makeAgent().state).toBe(AgentState.Idle);
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
      hatType: [HatType.Black], provider, model: 'mock-model',
    });
    agent.receive(makeDirectMessage('Hello', 'human'));
    await waitForProcessing();
    expect(provider.calls[0]?.systemPrompt).toContain('Alex');
  });

  it('system prompt contains hat label', async () => {
    const provider = new MockProvider({ content: 'ok' });
    const agent = new Agent({
      identity: { name: 'Alex', visualDescription: 'Sharp analyst.' },
      hatType: [HatType.Black],
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
      hatType: [HatType.Black], provider, model: 'mock-model',
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
    expect(json['hatType']).toEqual([HatType.Black]);
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

const mcpTool = (name: string, description: string) => ({
  name, description, parameters: { type: 'object' as const, properties: {} },
});

const EMAIL_GET = mcpTool('mcp__email-imap__get_email', 'Get the full content of an email by ID.');
const EMAIL_LABEL = mcpTool('mcp__email-imap__create_label', 'Create a mailbox label.');
const KANBAN = mcpTool('mcp__kanban__create_ticket', 'Create a kanban ticket.');

/** Wire the agent up the way the orchestrator does, through the real splitter. */
const withTools = (agent: Agent, upfrontTools?: string[]) =>
  agent.setExtraToolsProvider(() =>
    splitToolSet({ personal: [EMAIL_GET, EMAIL_LABEL], shared: [KANBAN] }, upfrontTools));

const toolsSent = (provider: MockProvider, call = 0) =>
  provider.calls[call]?.tools?.map(t => t.name) ?? [];

describe('Which tools reach the model', () => {
  it('sends the agent its own MCP tools without making it search first', async () => {
    // Somebody configured this agent a mailbox on purpose. Making it discover
    // that for itself is how an agent ends up reporting it cannot read mail.
    const provider = new MockProvider({ content: 'ok' });
    const agent = makeAgent({ provider });
    withTools(agent);
    agent.setResponseHandler(async () => {});
    agent.receive(makeDirectMessage('Read my mail'));
    await waitForProcessing();

    expect(toolsSent(provider)).toContain('mcp__email-imap__get_email');
    // A team server can run to hundreds of tools, so those stay behind
    // search_tools.
    expect(toolsSent(provider)).not.toContain('mcp__kanban__create_ticket');
  });

  it('sends only the tools a template asks for upfront', async () => {
    const provider = new MockProvider({ content: 'ok' });
    const agent = makeAgent({ provider });
    withTools(agent, ['email-imap:get_email', 'kanban']);
    agent.setResponseHandler(async () => {});
    agent.receive(makeDirectMessage('Read my mail'));
    await waitForProcessing();

    const names = toolsSent(provider);
    expect(names).toContain('mcp__email-imap__get_email');
    // A team server can be put in front of the model too.
    expect(names).toContain('mcp__kanban__create_ticket');
    // The rest of what the mail server offers is not worth the context.
    expect(names).not.toContain('mcp__email-imap__create_label');
  });

  it('sends no MCP tools at all when a template asks for none', async () => {
    const provider = new MockProvider({ content: 'ok' });
    const agent = makeAgent({ provider });
    withTools(agent, []);
    agent.setResponseHandler(async () => {});
    agent.receive(makeDirectMessage('Hello'));
    await waitForProcessing();

    expect(toolsSent(provider).filter(n => n.startsWith('mcp__'))).toEqual([]);
  });

  it('still lets the agent find a tool it was not given', async () => {
    const provider = new MockProvider([
      { content: '', toolCalls: [{ id: 'tc1', name: 'search_tools', arguments: { query: 'create a ticket' } }] },
      { content: 'Done.' },
    ]);
    const agent = makeAgent({ provider });
    withTools(agent, []);
    agent.setResponseHandler(async () => {});
    agent.receive(makeDirectMessage('Raise a ticket'));
    await waitForProcessing();

    const toolMsg = provider.calls[1]?.messages.find(m => m.role === 'tool');
    expect(toolMsg?.content).toContain('mcp__kanban__create_ticket');
  });

  it('does not duplicate a tool the model also asks get_tool for', async () => {
    const provider = new MockProvider([
      { content: '', toolCalls: [{ id: 'tc1', name: 'get_tool', arguments: { name: 'get_email' } }] },
      { content: 'Done.' },
    ]);
    const agent = makeAgent({ provider });
    withTools(agent);
    agent.setResponseHandler(async () => {});
    agent.receive(makeDirectMessage('Read my mail'));
    await waitForProcessing();

    expect(toolsSent(provider, 1).filter(n => n === 'mcp__email-imap__get_email')).toHaveLength(1);
  });
});

describe('Tool search pattern', () => {
  it('only passes core tools in initial LLM call', async () => {
    const provider = new MockProvider({ content: 'ok' });
    const agent = makeAgent({ provider });
    agent.setResponseHandler(async () => {});
    agent.receive(makeDirectMessage('Hello'));
    await waitForProcessing();
    const toolNames = provider.calls[0]?.tools?.map(t => t.name) ?? [];
    // Core tools present
    expect(toolNames).toContain('search_tools');
    expect(toolNames).toContain('get_tool');
    expect(toolNames).toContain('escalate_to_human');
    // On-demand tools absent
    expect(toolNames).not.toContain('read_file');
    expect(toolNames).not.toContain('web_search');
    expect(toolNames).not.toContain('write_file');
  });

  it('search_tools is handled internally and never reaches toolExecutor', async () => {
    const executorCalls: string[] = [];
    const provider = new MockProvider([
      { content: '', toolCalls: [{ id: 'tc1', name: 'search_tools', arguments: { query: 'file' } }] },
      { content: 'Done.' },
    ]);
    const agent = makeAgent({ provider });
    agent.setToolExecutor(async (_name, call) => { executorCalls.push(call.name); return 'ok'; });
    agent.setResponseHandler(async () => {});
    agent.receive(makeDirectMessage('Find file tools'));
    await waitForProcessing();
    expect(executorCalls).not.toContain('search_tools');
    // The tool result passed back to the LLM should include file-related tools
    const toolMsg = provider.calls[1]?.messages.find(m => m.role === 'tool');
    expect(toolMsg?.content).toContain('read_file');
  });

  it('get_tool injects the discovered tool into subsequent LLM calls', async () => {
    const provider = new MockProvider([
      { content: '', toolCalls: [{ id: 'tc1', name: 'get_tool', arguments: { name: 'read_file' } }] },
      { content: '', toolCalls: [{ id: 'tc2', name: 'read_file', arguments: { filename: 'notes.md' } }] },
      { content: 'Done.' },
    ]);
    const agent = makeAgent({ provider });
    agent.setToolExecutor(async () => 'file content');
    agent.setResponseHandler(async () => {});
    agent.receive(makeDirectMessage('Read notes.md'));
    await waitForProcessing();
    // First call: only core tools
    expect(provider.calls[0]?.tools?.map(t => t.name)).not.toContain('read_file');
    // Second call: read_file injected after get_tool
    expect(provider.calls[1]?.tools?.map(t => t.name)).toContain('read_file');
  });

  it('get_tool does not reach toolExecutor', async () => {
    const executorCalls: string[] = [];
    const provider = new MockProvider([
      { content: '', toolCalls: [{ id: 'tc1', name: 'get_tool', arguments: { name: 'web_search' } }] },
      { content: 'Done.' },
    ]);
    const agent = makeAgent({ provider });
    agent.setToolExecutor(async (_name, call) => { executorCalls.push(call.name); return 'ok'; });
    agent.setResponseHandler(async () => {});
    agent.receive(makeDirectMessage('Search for something'));
    await waitForProcessing();
    expect(executorCalls).not.toContain('get_tool');
  });
});

describe('tool-search utils', () => {
  const registry = buildToolRegistry(getAllToolsForHat([HatType.Black]));

  it('searchTools returns matches by name', () => {
    const result = JSON.parse(searchTools('read', registry));
    const names = result.results.map((r: { name: string }) => r.name);
    expect(names).toContain('read_file');
  });

  it('searchTools returns matches by description keyword', () => {
    const result = JSON.parse(searchTools('schedule', registry));
    const names = result.results.map((r: { name: string }) => r.name);
    expect(names).toContain('schedule_action');
  });

  it('searchTools returns empty results for unknown query', () => {
    const result = JSON.parse(searchTools('xyzzy_unknown', registry));
    expect(result.results).toHaveLength(0);
  });

  it('getTool returns full schema for known tool', () => {
    const result = getTool('read_file', registry);
    expect(result.found).toBe(true);
    expect(result.schema?.name).toBe('read_file');
  });

  it('getTool returns found=false for unknown tool', () => {
    const result = getTool('nonexistent', registry);
    expect(result.found).toBe(false);
    expect(result.result).toContain('not found');
  });

  it('SEARCH_TOOLS and GET_TOOL are in the registry', () => {
    expect(registry.has('search_tools')).toBe(true);
    expect(registry.has('get_tool')).toBe(true);
  });
});
