import { WebSocket } from 'ws';
import { StoredEvent } from '../store/event-store.js';
import { TeamOrchestrator } from '../orchestrator/orchestrator.js';
import { HumanRequest } from '../orchestrator/types.js';
import type { SpeechGateway } from '../speech/speech-gateway.js';
import { AgentStatus } from './project-manager.js';
import { HumanRequestStore } from './human-request-store.js';
import { EmailAllowlistStore } from './email-allowlist-store.js';

export interface OrchestratorEventContext {
  agentActivity: Map<string, { activity: string; talkingTo?: string }>;
  talkingTimers: Map<string, ReturnType<typeof setTimeout>>;
  pendingHumanTurns: Map<string, (input: string | null) => void>;
  pendingTurnAcks: Map<string, () => void>;
  humanRequestStore: HumanRequestStore;
  emailAllowlistStore: EmailAllowlistStore | null;
  agentTicketMap: Map<string, string>;
  kanban: {
    updateKanbanColumn(id: string, col: string, closedReason?: string): Promise<void>;
    addTicketComment(id: string, author: string, text: string): Promise<void>;
  };
  getOrchestrator(): TeamOrchestrator;
  /** Resolve an agent name to its stable UUID (returns name unchanged if not found). */
  agentIdForName(name: string): string;
  speechInterest: Map<WebSocket, { agentName: string; voiceName?: string; speakerName?: string }>;
  speech: SpeechGateway;
  sseBroadcast(data: object): void;
  buildAgentStatuses(): AgentStatus[];
}

export function handleOrchestratorEvent(ev: StoredEvent, ctx: OrchestratorEventContext): void {
  let changed = false;

  switch (ev.type) {
    case 'task_assigned': {
      const to   = ev['to']   as string | undefined;
      const task = ev['task'] as string | undefined;
      if (to) { ctx.agentActivity.set(ctx.agentIdForName(to), { activity: task ?? 'Working on task' }); changed = true; }
      break;
    }
    case 'direct_message': {
      const from = ev['from'] as string | undefined;
      const to   = ev['to']   as string | undefined;
      if (from && to) {
        const fromId = ctx.agentIdForName(from);
        ctx.agentActivity.set(fromId, { activity: `Messaging ${to}…`, talkingTo: to });
        const prev = ctx.talkingTimers.get(fromId);
        if (prev) clearTimeout(prev);
        ctx.talkingTimers.set(fromId, setTimeout(() => {
          const cur = ctx.agentActivity.get(fromId);
          if (cur) { cur.talkingTo = undefined; ctx.sseBroadcast({ type: 'agent_update', agents: ctx.buildAgentStatuses() }); }
        }, 5000));
        changed = true;
      }
      break;
    }
    case 'agent_response': {
      const from    = ev['from']    as string | undefined;
      const content = ev['content'] as string | undefined;
      if (from) {
        ctx.agentActivity.set(ctx.agentIdForName(from), { activity: (content ?? '').trim() || 'Responded' });
        changed = true;
        ctx.sseBroadcast({ type: 'cli_output', kind: 'agent', from, content: content ?? '' });

        if (content && ctx.speech.isAvailable()) {
          const interested = [...ctx.speechInterest.entries()].filter(([, info]) => info.agentName === from);
          if (interested.length > 0) {
            // Listeners wanting the same voice share one synthesis; the key is
            // the voice/speaker pair, since that is what changes the audio.
            const byVoice = new Map<string, { voiceName?: string; speakerName?: string; clients: WebSocket[] }>();
            for (const [ws, info] of interested) {
              const key = `${info.voiceName ?? ''}|${info.speakerName ?? ''}`;
              const group = byVoice.get(key)
                ?? { ...(info.voiceName && { voiceName: info.voiceName }), ...(info.speakerName && { speakerName: info.speakerName }), clients: [] };
              group.clients.push(ws);
              byVoice.set(key, group);
            }

            for (const { voiceName, speakerName, clients } of byVoice.values()) {
              // Each sentence is forwarded the moment it is rendered, so audio
              // and lip movement start before the utterance is finished.
              ctx.speech.speak(content, from, voiceName, speakerName, (chunk) => {
                const msg = JSON.stringify({ type: 'speech_chunk', data: chunk });
                for (const ws of clients) {
                  if (ws.readyState === WebSocket.OPEN) ws.send(msg);
                }
              }).catch(() => { /* speech is an enhancement — never break the reply */ });
            }
          }
        }
      }
      break;
    }
    case 'task_complete': {
      const agent = ev['agent'] as string | undefined;
      if (agent) {
        const agentId = ctx.agentIdForName(agent);
        ctx.agentActivity.set(agentId, { activity: 'Task complete' });
        changed = true;
        const ticketId = ctx.agentTicketMap.get(agentId);
        if (ticketId) {
          ctx.kanban.updateKanbanColumn(ticketId, 'closed', 'completed').catch(() => {});
          ctx.agentTicketMap.delete(agentId);
        }
      }
      break;
    }
    case 'meeting_started': {
      const facilitator  = ev['facilitator']  as string | undefined;
      const participants = ev['participants'] as string[] | undefined;
      const topic        = ev['topic']        as string | undefined;
      const meetingId    = ev['meetingId']    as string | undefined;
      const label = `Meeting: ${(topic ?? '').slice(0, 50)}`;
      for (const name of [facilitator, ...(participants ?? [])].filter(Boolean) as string[]) {
        ctx.agentActivity.set(ctx.agentIdForName(name), { activity: label });
      }
      const hasHuman = (participants ?? []).includes('human');
      ctx.sseBroadcast({ type: 'meeting_started', meetingId, topic, facilitator, participants, hasHuman });
      changed = true;
      break;
    }
    case 'meeting_turn': {
      const meetingId   = ev['meetingId']   as string | undefined;
      const participant = ev['participant'] as string | undefined;
      const content     = ev['content']     as string | undefined;
      ctx.sseBroadcast({ type: 'meeting_turn', meetingId, participant, content });
      break;
    }
    case 'meeting_closed': {
      const meetingId = ev['meetingId'] as string | undefined;
      const topic     = ev['topic']     as string | undefined;
      ctx.sseBroadcast({ type: 'meeting_closed', meetingId, topic });
      const resolver = ctx.pendingHumanTurns.get(meetingId ?? '');
      if (resolver) { ctx.pendingHumanTurns.delete(meetingId!); resolver(null); }
      const ackResolver = ctx.pendingTurnAcks.get(meetingId ?? '');
      if (ackResolver) { ctx.pendingTurnAcks.delete(meetingId!); ackResolver(); }
      break;
    }
    case 'escalation': {
      const from    = ev['from']    as string | undefined;
      const message = ev['message'] as string | undefined;
      const urgency = ev['urgency'] as string | undefined;
      if (from) {
        const fromId = ctx.agentIdForName(from);
        ctx.agentActivity.set(fromId, { activity: 'Waiting for human…' });
        changed = true;
        ctx.sseBroadcast({ type: 'cli_output', kind: 'escalation', from, content: message ?? '' });
        const ticketId = ctx.agentTicketMap.get(fromId);
        if (ticketId) {
          ctx.kanban.updateKanbanColumn(ticketId, 'blocked').catch(() => {});
          if (message) ctx.kanban.addTicketComment(ticketId, from, `Blocked: ${message}`).catch(() => {});
        }
        const reqId   = `req-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const files = Array.isArray(ev['files']) ? (ev['files'] as string[]) : [];
        const request: HumanRequest = {
          id: reqId, agentName: from, message: message ?? '',
          urgency: urgency === 'high' ? 'high' : 'low',
          relatedTicketId: ticketId,
          ...(files.length > 0 && { files }),
          status: 'pending', createdAt: new Date().toISOString(),
        };
        ctx.humanRequestStore.add(request).catch(() => {});
        ctx.sseBroadcast({ type: 'requests_update', requests: ctx.humanRequestStore.list() });
      }
      break;
    }
    case 'email_approval_requested': {
      const from  = ev['from']  as string | undefined;
      const email = ev['email'] as string | undefined;
      if (from && email) {
        ctx.sseBroadcast({ type: 'cli_output', kind: 'system', from, content: `${from} is requesting approval to use email address: ${email}` });
        ctx.sseBroadcast({ type: 'email_allowlist_update', allowlist: ctx.emailAllowlistStore?.list() ?? [] });
      }
      break;
    }
    case 'mcp_server_added':
      ctx.sseBroadcast({ type: 'tools_update', tools: ctx.getOrchestrator().getToolInfo() });
      break;
  }

  if (changed) ctx.sseBroadcast({ type: 'agent_update', agents: ctx.buildAgentStatuses() });
}

export function bufferAgentFeedEvent(
  ev: StoredEvent,
  agentFeeds: Map<string, StoredEvent[]>,
  feedLimit: number,
  sseBroadcast: (data: object) => void,
  agentIdForName: (name: string) => string,
): void {
  const targets: string[] = [];
  switch (ev.type) {
    case 'tool_call':
    case 'tool_result':
    case 'tool_error':
    case 'task_complete':
      { const a = ev['agent'] as string | undefined; if (a) targets.push(a); break; }
    case 'agent_response':
    case 'escalation':
      { const f = ev['from'] as string | undefined; if (f) targets.push(f); break; }
    case 'direct_message':
      { const f = ev['from'] as string | undefined; if (f) targets.push(f);
        const t = ev['to']   as string | undefined; if (t && t !== 'human') targets.push(t); break; }
    case 'task_assigned':
      { const t = ev['to']   as string | undefined; if (t) targets.push(t);
        const f = ev['from'] as string | undefined; if (f && f !== 'human') targets.push(f); break; }
    case 'human_message':
    case 'human_reply':
      { const t = ev['to'] as string | undefined; if (t) targets.push(t); break; }
  }
  for (const name of [...new Set(targets)]) {
    const id = agentIdForName(name);
    if (!agentFeeds.has(id)) agentFeeds.set(id, []);
    const buf = agentFeeds.get(id)!;
    buf.push(ev);
    if (buf.length > feedLimit) buf.shift();
    sseBroadcast({ type: 'agent_stream', agent: name, event: ev });
  }
}
