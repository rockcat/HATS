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

// ── File tools (all agents) ───────────────────────────────────────────────────

const READ_FILE: ToolDefinition = {
  name: 'read_file',
  description: 'Read the contents of a file. Use paths within your project folder to access saved work.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path to read. Relative to the current working directory.' },
    },
    required: ['path'],
  },
};

const WRITE_FILE: ToolDefinition = {
  name: 'write_file',
  description: 'Write or create a file. Save research, notes, drafts, and documents to your project folder.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path to write. Relative to the current working directory.' },
      content: { type: 'string', description: 'Full content to write to the file.' },
    },
    required: ['path', 'content'],
  },
};

const LIST_FILES: ToolDefinition = {
  name: 'list_files',
  description: 'List files and subdirectories at a given path.',
  parameters: {
    type: 'object',
    properties: {
      directory: { type: 'string', description: 'Directory to list. Defaults to the current working directory.' },
    },
    required: [],
  },
};

const WEB_SEARCH: ToolDefinition = {
  name: 'web_search',
  description: 'Search the web for up-to-date information. Returns titles, URLs, and snippets. Requires BRAVE_SEARCH_API_KEY environment variable.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query.' },
      count: { type: 'number', description: 'Number of results (1–10, default 5).' },
    },
    required: ['query'],
  },
};

// ── Tools available to Blue Hat (PM) only ────────────────────────────────────

const ASSIGN_TASK: ToolDefinition = {
  name: 'assign_task',
  description: 'Assign a task to a specific team member by name. A project folder is automatically created to store the agent\'s work.',
  parameters: {
    type: 'object',
    properties: {
      agent: { type: 'string', description: 'Name of the team member to assign the task to.' },
      task: { type: 'string', description: 'Clear description of the task.' },
      context: { type: 'string', description: 'Any background or constraints the agent should know.' },
      projectName: { type: 'string', description: 'Short name for the project folder (e.g. "icp-research"). Auto-generated from the task if omitted.' },
    },
    required: ['agent', 'task'],
  },
};

const SCHEDULE_MEETING: ToolDefinition = {
  name: 'schedule_meeting',
  description: 'Schedule a meeting for a future date and time. The meeting will start automatically when the scheduled time arrives.',
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['standup', 'sprint_planning', 'retro', 'review', 'ad_hoc'],
        description: 'The type of meeting.',
      },
      participants: {
        type: 'array',
        items: { type: 'string' },
        description: 'Names of team members to invite. Use "human" to include the human team lead.',
      },
      topic: { type: 'string', description: 'What the meeting is about.' },
      agenda: { type: 'string', description: 'The agenda or questions to address.' },
      scheduledFor: {
        type: 'string',
        description: 'ISO-8601 date-time when the meeting should start, e.g. "2026-04-01T09:00:00".',
      },
    },
    required: ['type', 'participants', 'topic', 'scheduledFor'],
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

const BASE_TOOLS = [SEND_MESSAGE, ESCALATE_TO_HUMAN, REPORT_TASK_COMPLETE, READ_FILE, WRITE_FILE, LIST_FILES, WEB_SEARCH];
const BLUE_HAT_TOOLS = [...BASE_TOOLS, ASSIGN_TASK, REQUEST_MEETING, SCHEDULE_MEETING];

export function getToolsForHat(hatType: HatType): ToolDefinition[] {
  return hatType === HatType.Blue ? BLUE_HAT_TOOLS : BASE_TOOLS;
}
