import { ToolDefinition } from '../providers/types.js';
import { HatType } from '../hats/types.js';

// ── Tools available to every agent ───────────────────────────────────────────

const SEND_MESSAGE: ToolDefinition = {
  name: 'send_message',
  description: 'Send a direct message to another team member by name.',
  parameters: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Name of the team member to message.' },
      message: { type: 'string', description: 'The message content.' },
    },
    required: ['to', 'message'],
  },
};

const ESCALATE_TO_HUMAN: ToolDefinition = {
  name: 'escalate_to_human',
  description: 'Raise a question or blocker with the human team lead. Use when you need a decision, approval, or information only the human can provide.',
  parameters: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Your question or the blocker you have encountered.' },
      urgency: {
        type: 'string',
        enum: ['low', 'high'],
        description: 'low = can wait for next check-in; high = blocking work, needs prompt response.',
      },
    },
    required: ['message', 'urgency'],
  },
};

const REPORT_TASK_COMPLETE: ToolDefinition = {
  name: 'report_task_complete',
  description: 'Mark your current task as complete and summarise what you did or decided.',
  parameters: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'What was done, decided, or produced.' },
    },
    required: ['summary'],
  },
};

// ── Tools available to Blue Hat (PM) only ────────────────────────────────────

const ASSIGN_TASK: ToolDefinition = {
  name: 'assign_task',
  description: 'Assign a task to a specific team member by name.',
  parameters: {
    type: 'object',
    properties: {
      agent: { type: 'string', description: 'Name of the team member to assign the task to.' },
      task: { type: 'string', description: 'Clear description of the task.' },
      context: { type: 'string', description: 'Any background or constraints the agent should know.' },
    },
    required: ['agent', 'task'],
  },
};

const REQUEST_MEETING: ToolDefinition = {
  name: 'request_meeting',
  description: 'Call a team meeting. You will facilitate. Invite specific team members and optionally the human.',
  parameters: {
    type: 'object',
    properties: {
      participants: {
        type: 'array',
        items: { type: 'string' },
        description: 'Names of team members to invite. Use "human" to include the human team lead.',
      },
      topic: { type: 'string', description: 'What the meeting is about.' },
      agenda: { type: 'string', description: 'The agenda or questions to address.' },
    },
    required: ['participants', 'topic'],
  },
};

// ── Registry ──────────────────────────────────────────────────────────────────

const BASE_TOOLS = [SEND_MESSAGE, ESCALATE_TO_HUMAN, REPORT_TASK_COMPLETE];
const BLUE_HAT_TOOLS = [...BASE_TOOLS, ASSIGN_TASK, REQUEST_MEETING];

export function getToolsForHat(hatType: HatType): ToolDefinition[] {
  return hatType === HatType.Blue ? BLUE_HAT_TOOLS : BASE_TOOLS;
}
