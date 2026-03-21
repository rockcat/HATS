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
}
