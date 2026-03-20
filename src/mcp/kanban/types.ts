export type Column =
  | 'backlog'
  | 'ready'       // ready to start
  | 'in_progress'
  | 'blocked'
  | 'completed';

export type Priority = 'low' | 'medium' | 'high' | 'critical';

export interface Comment {
  id: string;
  author: string;
  text: string;
  ts: string;
}

export interface Ticket {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  column: Column;
  creator: string;
  assignee?: string;
  tags: string[];
  comments: Comment[];
  createdAt: string;
  updatedAt: string;
}

export interface Board {
  tickets: Record<string, Ticket>;   // id → ticket
  nextSeq: number;                    // for human-readable IDs like TKT-001
}
