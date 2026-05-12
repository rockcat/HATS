import { Message, ToolCall } from '../providers/types.js';
import { AgentMessage } from './types.js';
import { TeamMessage } from '../orchestrator/types.js';

export function sanitizeHistory<T extends { role: string; toolCalls?: ToolCall[]; toolCallId?: string }>(
  messages: T[],
): T[] {
  if (messages.length === 0) return messages;

  const firstUser = messages.findIndex((m) => m.role === 'user' && !m.toolCallId);
  const msgs = firstUser > 0 ? messages.slice(firstUser) : [...messages];

  const out: T[] = [];
  let i = 0;

  while (i < msgs.length) {
    const m = msgs[i]!;

    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      const results: T[] = [];
      let j = i + 1;
      while (j < msgs.length && msgs[j]!.role === 'tool') {
        results.push(msgs[j]!);
        j++;
      }

      const expectedIds = new Set(m.toolCalls.map((tc) => tc.id));
      const coveredIds  = new Set(results.map((r) => r.toolCallId));
      const complete    = expectedIds.size > 0 &&
        [...expectedIds].every((id) => coveredIds.has(id));

      if (complete) {
        out.push(m);
        for (const r of results) out.push(r);
      }
      i = j;

    } else if (m.role === 'tool') {
      i++;
    } else {
      out.push(m);
      i++;
    }
  }

  return out;
}

export function toProviderMessage(m: AgentMessage): Message {
  return {
    role: m.role,
    content: m.content,
    toolCalls: m.toolCalls,
    toolCallId: m.toolCallId,
    toolName: m.toolName,
  };
}

export function formatIncomingMessage(msg: TeamMessage): string {
  switch (msg.type) {
    case 'task':
      return `[TASK from ${msg.from}] ${msg.content}`;
    case 'direct':
      return `[MESSAGE from ${msg.from}] ${msg.content}`;
    case 'meeting_invite':
      return `[MEETING INVITE from ${msg.from}] ${msg.content}`;
    case 'escalation':
      return `[ESCALATION from ${msg.from}] ${msg.content}`;
    case 'human_reply':
      return `[HUMAN REPLY] ${msg.content}`;
    case 'task_complete':
      return `[TASK COMPLETE from ${msg.from}] ${msg.content}`;
    default:
      return msg.content;
  }
}
