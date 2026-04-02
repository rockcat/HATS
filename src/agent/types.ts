import { HatType } from '../hats/types.js';
import { AIProvider, ToolCall } from '../providers/types.js';
import { TeamMessage } from '../orchestrator/types.js';

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

export interface AgentIdentity {
  name: string;
  visualDescription: string;
  specialisation?: string;  // shown in team roster, e.g. "financial analysis"
  backstory?: string;
  avatar?: string;          // avatar file name, e.g. "morgan.glb"
  background?: string;      // background image filename, e.g. "bg-office.png"
  voice?: string;           // TTS voice name
  speakerName?: string;     // TTS speaker name (for multi-speaker voices)
}

export interface AgentConfig {
  id?: string;             // stable UUID — if provided, preserved across save/restore
  identity: AgentIdentity;
  hatType: HatType;
  provider: AIProvider;
  model: string;
  teamContext?: string;    // injected by orchestrator after team is assembled
  projectDir?: string;     // absolute path to current project folder
}

export interface AgentMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: Date;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  toolName?: string;
}

/**
 * Called by the orchestrator when the agent uses a tool.
 * Returns the string result to feed back to the LLM.
 */
export type ToolExecutor = (agentName: string, call: ToolCall) => Promise<string>;

/**
 * Called when the agent produces a final text response to a message.
 * The orchestrator uses this to route replies.
 */
export type ResponseHandler = (agentName: string, message: TeamMessage, response: string) => Promise<void>;
