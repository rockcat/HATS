export type Column =
  | 'backlog'
  | 'ready'       // ready to start
  | 'in_progress'
  | 'blocked'
  | 'review'      // awaiting review before completion
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
  blockedBy?: string[];    // ticket IDs that must complete before this one
  projectName?: string;    // human-readable project name
  projectFolder?: string;  // absolute path to the project working folder
}

export interface Board {
  tickets: Record<string, Ticket>;   // id → ticket
  nextSeq: number;                    // for human-readable IDs like TKT-001
}
