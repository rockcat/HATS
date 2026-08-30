import { describe, it, expect } from 'vitest';
import { mapOrchestratorEvent, type EventMapperContext } from './event-mapper.js';
import { eventMatchesFilter } from './types.js';
import type { StoredEvent } from '../store/event-store.js';

const ctx: EventMapperContext = {
  agentIdForName: (name) => (name === 'Amara' ? 'agent-1' : name === 'Blake' ? 'agent-2' : undefined),
  activityFor: (id) => (id === 'agent-1' ? { activity: 'Working…', talkingTo: 'Blake' } : undefined),
  stateFor: (id) => (id === 'agent-1' ? 'working' : 'idle'),
};

const event = (type: string, payload: Record<string, unknown> = {}): StoredEvent =>
  ({ id: 'e1', ts: '2026-08-29T10:00:00.000Z', type, ...payload });

describe('mapOrchestratorEvent', () => {
  it('turns an agent response into a message plus a state update', () => {
    const mapped = mapOrchestratorEvent(event('agent_response', { from: 'Amara', content: 'Here is my view.' }), ctx);

    const message = mapped.find((e) => e.type === 'agent_message');
    expect(message).toMatchObject({
      agentId: 'agent-1', name: 'Amara', role: 'assistant',
      content: 'Here is my view.', thread: 'general',
      timestamp: '2026-08-29T10:00:00.000Z',
    });
    expect(mapped.find((e) => e.type === 'agent_state')).toMatchObject({
      agentId: 'agent-1', state: 'working', activity: 'Working…', talkingTo: 'Blake',
    });
  });

  it('routes a message to the thread it belongs to', () => {
    const [message] = mapOrchestratorEvent(event('agent_response', { from: 'Amara', content: 'x', threadId: 'ticket-7' }), ctx);
    expect(message).toMatchObject({ thread: 'ticket-7' });
  });

  it('uses the meeting id as the thread for meeting turns', () => {
    const [message] = mapOrchestratorEvent(event('meeting_turn', { participant: 'Amara', content: 'Agreed.', meetingId: 'm-9' }), ctx);
    expect(message).toMatchObject({ thread: 'm-9', meetingId: 'm-9', role: 'assistant' });
  });

  it('ignores the human\'s own meeting turns', () => {
    expect(mapOrchestratorEvent(event('meeting_turn', { participant: 'human', content: 'hi' }), ctx)).toEqual([]);
  });

  it('reports a human message as a user-role message on the target agent', () => {
    const [message] = mapOrchestratorEvent(event('human_message', { to: 'Amara', content: 'Status?' }), ctx);
    expect(message).toMatchObject({ agentId: 'agent-1', role: 'user', content: 'Status?' });
  });

  it('emits only a state change for task assignment', () => {
    const mapped = mapOrchestratorEvent(event('task_assigned', { to: 'Amara', task: 'Draft the plan' }), ctx);
    expect(mapped).toHaveLength(1);
    expect(mapped[0]?.type).toBe('agent_state');
  });

  it('drops events about agents this runner does not know', () => {
    expect(mapOrchestratorEvent(event('agent_response', { from: 'Ghost', content: 'boo' }), ctx)).toEqual([]);
  });

  it('drops internal event types that are not part of the public contract', () => {
    for (const type of ['tool_call', 'tool_result', 'mcp_server_added', 'state_saved', 'session_start']) {
      expect(mapOrchestratorEvent(event(type, { from: 'Amara' }), ctx), type).toEqual([]);
    }
  });
});

describe('eventMatchesFilter', () => {
  const filter = { agentId: 'agent-1' };

  it('always passes stream-level events through', () => {
    expect(eventMatchesFilter({ type: 'heartbeat' }, filter)).toBe(true);
    expect(eventMatchesFilter({ type: 'hello', agents: [], project: null }, filter)).toBe(true);
  });

  it('passes only the filtered agent\'s traffic', () => {
    const [mine] = mapOrchestratorEvent(event('agent_response', { from: 'Amara', content: 'x' }), ctx);
    const [theirs] = mapOrchestratorEvent(event('agent_response', { from: 'Blake', content: 'y' }), ctx);
    expect(eventMatchesFilter(mine!, filter)).toBe(true);
    expect(eventMatchesFilter(theirs!, filter)).toBe(false);
  });
});
