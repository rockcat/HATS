/**
 * Orchestrator event log → Embodiment API event stream.
 *
 * Internal events are numerous and change often; the embodiment stream is a
 * small stable set. Anything without a mapping here simply does not reach
 * external clients.
 */

import type { StoredEvent } from '../store/event-store.js';
import type { AgentMessageEvent, AgentStateEvent, EmbodimentEvent } from './types.js';

export interface EventMapperContext {
  /** Resolve an agent name to its stable instance id. */
  agentIdForName(name: string): string | undefined;
  /** Current activity label for an agent id, if the runner is tracking one. */
  activityFor(agentId: string): { activity: string; talkingTo?: string } | undefined;
  /** Current state string for an agent id. */
  stateFor(agentId: string): string | undefined;
}

const str = (ev: StoredEvent, key: string): string | undefined => {
  const value = ev[key];
  return typeof value === 'string' ? value : undefined;
};

function stateEvent(name: string, ctx: EventMapperContext): AgentStateEvent | null {
  const agentId = ctx.agentIdForName(name);
  if (!agentId) return null;
  const activity = ctx.activityFor(agentId);
  return {
    type: 'agent_state',
    agentId,
    name,
    state: ctx.stateFor(agentId) ?? 'idle',
    activity: activity?.activity ?? '',
    ...(activity?.talkingTo && { talkingTo: activity.talkingTo }),
  };
}

function messageEvent(
  ev: StoredEvent,
  name: string,
  role: AgentMessageEvent['role'],
  content: string,
  ctx: EventMapperContext,
): AgentMessageEvent | null {
  const agentId = ctx.agentIdForName(name);
  if (!agentId) return null;
  return {
    type: 'agent_message',
    agentId,
    name,
    thread: str(ev, 'threadId') ?? str(ev, 'meetingId') ?? 'general',
    role,
    content,
    timestamp: ev.ts,
    ...(str(ev, 'meetingId') && { meetingId: str(ev, 'meetingId') as string }),
  };
}

/**
 * Map one internal event to zero or more embodiment events.
 * Returning several is normal: a reply both delivers text and changes state.
 */
export function mapOrchestratorEvent(ev: StoredEvent, ctx: EventMapperContext): EmbodimentEvent[] {
  const events: EmbodimentEvent[] = [];

  switch (ev.type) {
    case 'agent_response': {
      const from = str(ev, 'from');
      const content = str(ev, 'content') ?? '';
      if (!from) break;
      const message = messageEvent(ev, from, 'assistant', content, ctx);
      if (message) events.push(message);
      break;
    }

    case 'human_message':
    case 'human_reply': {
      const to = str(ev, 'to');
      const content = str(ev, 'content') ?? '';
      if (!to) break;
      const message = messageEvent(ev, to, 'user', content, ctx);
      if (message) events.push(message);
      break;
    }

    case 'meeting_turn': {
      const participant = str(ev, 'participant');
      const content = str(ev, 'content') ?? '';
      if (!participant || participant === 'human') break;
      const message = messageEvent(ev, participant, 'assistant', content, ctx);
      if (message) events.push(message);
      break;
    }

    case 'direct_message': {
      const from = str(ev, 'from');
      if (from) { const s = stateEvent(from, ctx); if (s) events.push(s); }
      break;
    }

    case 'task_assigned': {
      const to = str(ev, 'to');
      if (to) { const s = stateEvent(to, ctx); if (s) events.push(s); }
      break;
    }

    case 'task_complete':
    case 'agent_disengaged': {
      const agent = str(ev, 'agent') ?? str(ev, 'from');
      if (agent) { const s = stateEvent(agent, ctx); if (s) events.push(s); }
      break;
    }

    case 'escalation': {
      const from = str(ev, 'from');
      if (from) { const s = stateEvent(from, ctx); if (s) events.push(s); }
      break;
    }

    default:
      break;
  }

  // Any event that produced a message also implies the speaker's state moved on.
  for (const event of [...events]) {
    if (event.type !== 'agent_message' || event.role !== 'assistant') continue;
    const state = stateEvent(event.name, ctx);
    if (state) events.push(state);
  }

  return events;
}
