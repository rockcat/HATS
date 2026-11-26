import type { PromptMode } from '../../../packages/core/src/prompt/types.js';

export type MessageType =
  | 'task'           // task assignment
  | 'direct'         // agent-to-agent or human-to-agent DM
  | 'meeting_invite' // invitation to a meeting
  | 'meeting_turn'   // a turn inside an ongoing meeting
  | 'escalation'     // agent escalating to human
  | 'human_reply'    // human responding to an agent or escalation
  | 'task_complete'; // agent reporting a task done

export interface TeamMessage {
  id: string;
  ts: string;
  type: MessageType;
  from: string;        // agent name or 'human'
  to: string;          // agent name, 'human', or meeting id
  content: string;
  meetingId?: string;
  taskId?: string;
  urgency?: 'low' | 'high';
  /** True for messages fired by the agenda/scheduler — final text response is suppressed. */
  isScheduled?: boolean;
  /** Thread key to seed this task's conversation from (e.g. the chat that spawned it). */
  sourceThreadId?: string;
  /** Max messages to copy from sourceThreadId (takes the most recent N). Absent = copy all. */
  sourceThreadLimit?: number;
  /** Target an explicit thread by ID instead of the default routing logic. */
  threadId?: string;
  /** Answer this one message with the full or condensed prompt, whatever the agent's own setting. */
  promptMode?: PromptMode;
}

export interface HumanRequest {
  id: string;
  agentName: string;
  message: string;
  urgency: 'low' | 'high';
  relatedTicketId?: string;
  /** Project files the request is about, as paths within the project — shown as links. */
  files?: string[];
  /**
   * `dismissed` is a decision, not a deletion: the human is not going to answer
   * and the agent has been told so. An escalated agent waits until it hears
   * something, so clearing a request without telling it strands it.
   */
  status: 'pending' | 'answered' | 'dismissed';
  response?: string;
  createdAt: string;
  answeredAt?: string;
  dismissedAt?: string;
  /** Optional note shown to the agent in place of an answer. */
  dismissalNote?: string;
}

export type TaskStatus = 'pending' | 'active' | 'complete' | 'blocked';

export interface Task {
  id: string;
  assignedTo: string;
  assignedBy: string;
  description: string;
  context?: string;
  status: TaskStatus;
  createdAt: string;
  completedAt?: string;
  summary?: string;
  projectName?: string;
  projectFolder?: string;
  ticketId?: string;       // kanban ticket ID this task was created from, e.g. "TKT-003"
}

export type MeetingType = 'standup' | 'sprint_planning' | 'retro' | 'review' | 'ad_hoc';
export type ScheduledMeetingStatus = 'scheduled' | 'launched' | 'cancelled';

export interface ScheduledMeeting {
  id: string;
  type: MeetingType;
  topic: string;
  agenda?: string;
  facilitator: string;
  participants: string[];
  scheduledFor: string;         // ISO-8601
  status: ScheduledMeetingStatus;
  createdBy: string;
  createdAt: string;
  launchedAt?: string;
  cancelledAt?: string;
  meetingId?: string;           // set when the live Meeting is created
}

export interface MeetingTurn {
  participant: string;  // agent name or 'human'
  content: string;
  ts: string;
}

export type MeetingStatus = 'open' | 'closed';

export interface Meeting {
  id: string;
  topic: string;
  agenda?: string;
  facilitator: string;   // agent name (Blue Hat)
  participants: string[]; // includes 'human' if invited
  status: MeetingStatus;
  turns: MeetingTurn[];
  createdAt: string;
  closedAt?: string;
  minutesPath?: string;  // absolute path to the saved minutes file, if any
}
