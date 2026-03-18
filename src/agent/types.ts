import { HatType } from '../hats/types.js';
import { AIProvider } from '../providers/types.js';

export enum AgentState {
  Idle = 'idle',
  Working = 'working',
  WaitingForHelp = 'waiting_for_help',
  InDiscussion = 'in_discussion',
}

export type AgentEvent =
  | 'task_assigned'
  | 'task_complete'
  | 'blocked'
  | 'help_received'
  | 'discussion_invited'
  | 'discussion_ended';

export interface AgentConfig {
  identity: {
    name: string;
    visualDescription: string;
    backstory?: string;
  };
  hatType: HatType;
  provider: AIProvider;
  model: string;
  teamContext?: string;
}

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}
