import { WebSocket } from 'ws';
import { StoredEvent } from '../store/event-store.js';
import { TeamOrchestrator } from '../orchestrator/orchestrator.js';
import { HumanRequest } from '../orchestrator/types.js';
import { VoiceManager } from '../speech/voice-manager.js';
import { processSpeech, isSpeechAvailable } from '../speech/pipeline.js';
import { AgentStatus } from './project-manager.js';

export interface OrchestratorEventContext {
  agentActivity: Map<string, { activity: string; talkingTo?: string }>;
  talkingTimers: Map<string, ReturnType<typeof setTimeout>>;
  pendingHumanTurns: Map<string, (input: string | null) => void>;
  pendingTurnAcks: Map<string, () => void>;
  humanRequests: Map<string, HumanRequest>;
  agentTicketMap: Map<string, string>;
  kanban: {
    updateKanbanColumn(id: string, col: string): Promise<void>;
    addTicketComment(id: string, author: string, text: string): Promise<void>;
    createEscalationTicket(from: string, msg: string, urgency: string): Promise<void>;
  };
  getOrchestrator(): TeamOrchestrator;
  speechInterest: Map<WebSocket, { agentName: string; voiceUrl: string | null; speakerId: number | null }>;
  voiceManager: VoiceManager;
  sseBroadcast(data: object): void;
  buildAgentStatuses(): AgentStatus[];
  buildRequestsList(): HumanRequest[];
}

export function handleOrchestratorEvent(ev: StoredEvent, ctx: OrchestratorEventContext): void {
  let changed = false;

  switch (ev.type) {
    case 'task_assigned': {
      const to   = ev['to']   as string | undefined;
      const task = ev['task'] as string | undefined;
      if (to) { ctx.agentActivity.set(to, { activity: task ?? 'Working on task' }); changed = true; }
      break;
    }
    case 'direct_message': {
      const from = ev['from'] as string | undefined;
      const to   = ev['to']   as string | undefined;
      if (from && to) {
        ctx.agentActivity.set(from, { activity: `Messaging ${to}…`, talkingTo: to });
        const prev = ctx.talkingTimers.get(from);
        if (prev) clearTimeout(prev);
        ctx.talkingTimers.set(from, setTimeout(() => {
          const cur = ctx.agentActivity.get(from);
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
        ctx.agentActivity.set(from, { activity: (content ?? '').trim() || 'Responded' });
        changed = true;
        ctx.sseBroadcast({ type: 'cli_output', kind: 'agent', from, content: content ?? '' });

        const hasSpeech = ctx.voiceManager.getVoices().length > 0 || isSpeechAvailable();
        if (content && hasSpeech) {
          const interested = [...ctx.speechInterest.entries()].filter(([, info]) => info.agentName === from);
          if (interested.length > 0) {
            const byVoice = new Map<string | null, WebSocket[]>();
            for (const [ws, { voiceUrl }] of interested) {
              const key = voiceUrl ?? null;
              if (!byVoice.has(key)) byVoice.set(key, []);
              byVoice.get(key)!.push(ws);
            }
            for (const [voiceUrl, clients] of byVoice) {
              const speakerId = interested.find(([ws]) => clients.includes(ws))?.[1]?.speakerId ?? null;
              processSpeech(content, from, voiceUrl, speakerId, (chunk) => {
                const msg = JSON.stringify({ type: 'speech_chunk', data: chunk });
                for (const ws of clients) {
                  if (ws.readyState === WebSocket.OPEN) ws.send(msg);
                }
              }).catch((err: Error) => {
                void err; // log.warn not imported here — suppress
              });
            }
          }
        }
      }
      break;
    }
    case 'task_complete': {
      const agent = ev['agent'] as string | undefined;
      if (agent) {
        ctx.agentActivity.set(agent, { activity: 'Task complete' });
        changed = true;
        const ticketId = ctx.agentTicketMap.get(agent.toLowerCase());
        if (ticketId) {
          ctx.kanban.updateKanbanColumn(ticketId, 'completed').catch(() => {});
          ctx.agentTicketMap.delete(agent.toLowerCase());
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
        ctx.agentActivity.set(name, { activity: label });
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
        ctx.agentActivity.set(from, { activity: 'Waiting for human…' });
        changed = true;
        ctx.sseBroadcast({ type: 'cli_output', kind: 'escalation', from, content: message ?? '' });
        const ticketId = ctx.agentTicketMap.get(from.toLowerCase());
        if (ticketId) {
          ctx.kanban.updateKanbanColumn(ticketId, 'blocked').catch(() => {});
          if (message) ctx.kanban.addTicketComment(ticketId, from, `Blocked: ${message}`).catch(() => {});
        }
        ctx.kanban.createEscalationTicket(from, message ?? '', urgency ?? 'medium').catch(() => {});
        const reqId   = `req-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const request: HumanRequest = {
          id: reqId, agentName: from, message: message ?? '',
          urgency: urgency === 'high' ? 'high' : 'low',
          relatedTicketId: ticketId,
          status: 'pending', createdAt: new Date().toISOString(),
        };
        ctx.humanRequests.set(reqId, request);
        ctx.sseBroadcast({ type: 'requests_update', requests: ctx.buildRequestsList() });
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
    const key = name.toLowerCase();
    if (!agentFeeds.has(key)) agentFeeds.set(key, []);
    const buf = agentFeeds.get(key)!;
    buf.push(ev);
    if (buf.length > feedLimit) buf.shift();
    sseBroadcast({ type: 'agent_stream', agent: name, event: ev });
  }
}
