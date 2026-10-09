/**
 * The event vocabulary of the Embodiment API.
 *
 * Deliberately narrower and more stable than the orchestrator's internal event
 * log: external clients should not have to track every internal event type the
 * runner grows. `event-mapper.ts` translates one into the other.
 */

import type { EmbodiedAgent } from '../../../packages/contracts/src/types.js';

export interface HelloEvent {
  type: 'hello';
  agents: EmbodiedAgent[];
  project: { id: string; name: string; goal: string } | null;
}

export interface AgentStateEvent {
  type: 'agent_state';
  agentId: string;
  name: string;
  state: string;
  activity: string;
  talkingTo?: string;
}

export interface AgentMessageEvent {
  type: 'agent_message';
  agentId: string;
  name: string;
  thread: string;
  role: 'assistant' | 'user';
  content: string;
  timestamp: string;
  /** Present when the message was produced inside a meeting. */
  meetingId?: string;
}

export interface AgentSpeechEvent {
  type: 'agent_speech';
  agentId: string;
  name: string;
  sentence: string;
  audioBase64: string;
  visemes: Array<{ viseme: string; start: number; end: number }>;
  durationMs: number;
  chunk: number;
  totalChunks: number;
}

export interface ProjectUpdateEvent {
  type: 'project_update';
  project: { id: string; name: string; goal: string; humanName: string; agentCount: number };
}

export interface HeartbeatEvent { type: 'heartbeat' }

/**
 * The runner asking a device to run one of the tools it declared.
 *
 * Goes only to the device it is addressed to — every other subscriber would
 * answer a question it was not asked.
 */
export interface DeviceRequestEvent {
  type: 'device_request';
  deviceId: string;
  id: string;
  tool: string;
  arguments: Record<string, unknown>;
  expiresAt: string;
}

export type EmbodimentEvent =
  | HelloEvent
  | AgentStateEvent
  | AgentMessageEvent
  | AgentSpeechEvent
  | ProjectUpdateEvent
  | DeviceRequestEvent
  | HeartbeatEvent;

/**
 * Clients may narrow the stream to a single agent, and identify themselves
 * as a device so work meant for them reaches them and nobody else.
 */
export interface EmbodimentEventFilter {
  agentId?: string;
  deviceId?: string;
}

export function eventMatchesFilter(event: EmbodimentEvent, filter: EmbodimentEventFilter): boolean {
  if (event.type === 'heartbeat' || event.type === 'hello' || event.type === 'project_update') return true;

  // A request addressed to one device must never reach another: it would
  // take a photo nobody asked it for, and answer a call it does not own.
  if (event.type === 'device_request') return event.deviceId === filter.deviceId;

  return filter.agentId === undefined || event.agentId === filter.agentId;
}
