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
  description: 'Read a file from your project outputs folder.',
  parameters: {
    type: 'object',
    properties: {
      filename: { type: 'string', description: 'File name to read, e.g. "report.md".' },
      ticket:   { type: 'string', description: 'Sub-folder within outputs/, e.g. "TKT-003" for ticket work or "minutes" for meeting notes. Omit to read directly from outputs/.' },
    },
    required: ['filename'],
  },
};

const WRITE_FILE: ToolDefinition = {
  name: 'write_file',
  description: 'Write or create a file in your project outputs folder.',
  parameters: {
    type: 'object',
    properties: {
      filename: { type: 'string', description: 'File name to write, e.g. "analysis.md".' },
      content:  { type: 'string', description: 'Full content to write to the file.' },
      ticket:   { type: 'string', description: 'Sub-folder within outputs/, e.g. "TKT-003" for ticket work or "minutes" for meeting notes. Omit to save directly in outputs/.' },
    },
    required: ['filename', 'content'],
  },
};

const LIST_FILES: ToolDefinition = {
  name: 'list_files',
  description: 'List files in your project outputs folder, optionally scoped to a sub-folder.',
  parameters: {
    type: 'object',
    properties: {
      ticket: { type: 'string', description: 'Sub-folder within outputs/ to list, e.g. "TKT-003" or "minutes". Omit to list the top-level outputs/ folder.' },
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

const GET_CURRENT_DATETIME: ToolDefinition = {
  name: 'get_current_datetime',
  description: 'Get the current date and time.',
  parameters: { type: 'object', properties: {}, required: [] },
};

const FETCH_URL: ToolDefinition = {
  name: 'fetch_url',
  description: 'Fetch the content of a URL and save it to your project outputs folder.',
  parameters: {
    type: 'object',
    properties: {
      url:      { type: 'string', description: 'The URL to fetch.' },
      filename: { type: 'string', description: 'File name to save as (e.g. "page.html"). Derived from the URL if omitted.' },
      ticket:   { type: 'string', description: 'Sub-folder within outputs/, e.g. "TKT-003" or "minutes". Omit to save directly in outputs/.' },
    },
    required: ['url'],
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

export const RAISE_HAND: ToolDefinition = {
  name: 'raise_hand',
  description: 'Signal that you want to speak again in the meeting discussion. Call this if you have more to contribute after your current turn. The facilitator will call on you when it is your turn.',
  parameters: { type: 'object', properties: {}, required: [] },
};

const DISENGAGE_CONVERSATION: ToolDefinition = {
  name: 'disengage_conversation',
  description: 'Signal that you have nothing more to contribute to this conversation thread and are stepping back. Use this when you have finished your part in the discussion and do not need to continue the back-and-forth. Your conversation partner will be notified so they can also wrap up if they wish.',
  parameters: { type: 'object', properties: {}, required: [] },
};

const REQUEST_EMAIL_APPROVAL: ToolDefinition = {
  name: 'request_email_approval',
  description: 'Request human approval to use an email address with email-sending MCP tools. You MUST call this and wait for approval before passing any email address to an MCP tool. Once approved, the address is stored and you can proceed.',
  parameters: {
    type: 'object',
    properties: {
      email:  { type: 'string', description: 'The email address you need to use.' },
      reason: { type: 'string', description: 'Why you need to contact this email address.' },
    },
    required: ['email'],
  },
};

const CHECK_EMAIL_PERMISSIONS: ToolDefinition = {
  name: 'check_email_permissions',
  description: 'Check the approval status of email addresses you have previously requested permission to contact. Returns each address with its current status (pending / approved / rejected). Use this after a scheduled check to see if the human has granted any new approvals, then act on them.',
  parameters: { type: 'object', properties: {}, required: [] },
};

// ── Agent self-scheduling tools (all agents) ──────────────────────────────────

const SCHEDULE_ACTION: ToolDefinition = {
  name: 'schedule_action',
  description: 'Schedule a future or recurring action for yourself. The system will send you the description text at the specified time. Use this to remind yourself to check email, follow up on a task, or perform any periodic check.',
  parameters: {
    type: 'object',
    properties: {
      label:           { type: 'string', description: 'Short name shown in the UI (e.g. "Check inbox").' },
      description:     { type: 'string', description: 'Instructions sent to you when this action fires — describe exactly what you should do.' },
      intervalMinutes: { type: 'number', description: 'Repeat every N minutes. Omit or set to 0 for a one-off action.' },
      delayMinutes:    { type: 'number', description: 'Minutes from now before the first run. Defaults to the interval (or 1 minute for one-off).' },
    },
    required: ['label', 'description'],
  },
};

const LIST_MY_ACTIONS: ToolDefinition = {
  name: 'list_my_actions',
  description: 'List your current scheduled actions, including their IDs, labels, intervals, and next run times.',
  parameters: { type: 'object', properties: {}, required: [] },
};

const CANCEL_ACTION: ToolDefinition = {
  name: 'cancel_action',
  description: 'Cancel a scheduled action by its ID. Use list_my_actions first to find the ID.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The action ID to cancel.' },
    },
    required: ['id'],
  },
};

// ── Registry ──────────────────────────────────────────────────────────────────

const BASE_TOOLS = [SEND_MESSAGE, ESCALATE_TO_HUMAN, REPORT_TASK_COMPLETE, DISENGAGE_CONVERSATION, READ_FILE, WRITE_FILE, LIST_FILES, WEB_SEARCH, FETCH_URL, GET_CURRENT_DATETIME, REQUEST_EMAIL_APPROVAL, CHECK_EMAIL_PERMISSIONS, SCHEDULE_ACTION, LIST_MY_ACTIONS, CANCEL_ACTION];
const BLUE_HAT_TOOLS = [...BASE_TOOLS, ASSIGN_TASK, REQUEST_MEETING, SCHEDULE_MEETING];

export function getToolsForHat(hatTypes: HatType[]): ToolDefinition[] {
  return hatTypes.includes(HatType.Blue) ? BLUE_HAT_TOOLS : BASE_TOOLS;
}

