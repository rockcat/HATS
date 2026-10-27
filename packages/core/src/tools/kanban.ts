// ── The kanban board's tools, as the model sees them ─────────────────────────
//
// Definitions only; the runner's mcp/kanban/tools.ts runs them. Here so that
// anything showing an agent's tool list — the agent library's preview — reads
// the same list the runner sends.

import type { ToolDefinition } from './types.js';

const COLUMNS = ['backlog', 'ready', 'in_progress', 'blocked', 'review', 'closed'];
const CLOSED_REASONS = ['completed', 'cancelled'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];

/** One tool, in the shape both the agent tool list and a test want. */
export interface KanbanTool {
  name: string;
  description: string;
  inputSchema: ToolDefinition['parameters'];
}

/**
 * The ones worth spending prompt on.
 *
 * Reading the board and moving a ticket across it are the hot path, and an
 * agent that has to go looking for them will not bother. The other seven —
 * blockers, deletion, reassignment — are occasional, and tool search finds
 * them when they are wanted. As an MCP server all eleven were namespaced
 * into the searchable pool, which made that choice by accident rather than
 * on purpose.
 */
export const UPFRONT_KANBAN_TOOLS = [
  'get_board', 'list_tickets', 'create_ticket', 'move_ticket',
] as const;

export const kanbanTools = (): KanbanTool[] => [
  {
    name: 'get_board',
    description: 'Get a summary of the kanban board showing all columns and their tickets.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'create_ticket',
    description: 'Create a new ticket in the backlog.',
    inputSchema: {
      type: 'object',
      properties: {
        title:       { type: 'string', description: 'Short title for the ticket.' },
        description: { type: 'string', description: 'Full description of the work.' },
        priority:    { type: 'string', enum: PRIORITIES, description: 'Priority level.' },
        creator:     { type: 'string', description: 'Name of the person or agent creating this ticket.' },
        assignee:    { type: 'string', description: 'Name of the person or agent to assign to (optional).' },
        tags:        { type: 'array', items: { type: 'string' }, description: 'Optional tags/labels.' },
        thread_id:   { type: 'string', description: 'Conversation thread key this ticket originates from. Injected automatically — do not set manually.' },
      },
      required: ['title', 'description', 'creator'],
    },
  },
  {
    name: 'get_ticket',
    description: 'Get full details of a ticket including comments.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Ticket ID, e.g. TKT-001.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'list_tickets',
    description: 'List tickets, optionally filtered by column, assignee, or tag.',
    inputSchema: {
      type: 'object',
      properties: {
        column:   { type: 'string', enum: COLUMNS, description: 'Filter by column.' },
        assignee: { type: 'string', description: 'Filter by assignee name.' },
        tag:      { type: 'string', description: 'Filter by tag.' },
      },
    },
  },
  {
    name: 'move_ticket',
    description: 'Move a ticket to a different column. Use "review" before closing; move back to "in_progress" if review fails. When moving to "closed", set closed_reason to "completed" or "cancelled".',
    inputSchema: {
      type: 'object',
      properties: {
        id:            { type: 'string', description: 'Ticket ID.' },
        column:        { type: 'string', enum: COLUMNS, description: 'Destination column.' },
        closed_reason: { type: 'string', enum: CLOSED_REASONS, description: 'Required when moving to "closed". Use "completed" for finished work or "cancelled" to abandon.' },
      },
      required: ['id', 'column'],
    },
  },
  {
    name: 'assign_ticket',
    description: 'Assign a ticket to a team member.',
    inputSchema: {
      type: 'object',
      properties: {
        id:       { type: 'string', description: 'Ticket ID.' },
        assignee: { type: 'string', description: 'Name of the assignee.' },
      },
      required: ['id', 'assignee'],
    },
  },
  {
    name: 'update_ticket',
    description: 'Update a ticket\'s title, description, priority, or tags.',
    inputSchema: {
      type: 'object',
      properties: {
        id:          { type: 'string', description: 'Ticket ID.' },
        // Each field is optional and only the ones given are changed, so each
        // has to say so — a model reading a bare `{type: string}` has no way
        // to know whether leaving it out clears the value.
        title:       { type: 'string', description: 'New title. Omit to leave it alone.' },
        description: { type: 'string', description: 'New description. Omit to leave it alone.' },
        priority:    { type: 'string', enum: PRIORITIES, description: 'New priority. Omit to leave it alone.' },
        tags:        { type: 'array', items: { type: 'string' }, description: 'Replaces the existing tags. Omit to leave them alone.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'add_comment',
    description: 'Add a comment or note to a ticket.',
    inputSchema: {
      type: 'object',
      properties: {
        id:     { type: 'string', description: 'Ticket ID.' },
        author: { type: 'string', description: 'Name of the commenter.' },
        text:   { type: 'string', description: 'Comment text.' },
      },
      required: ['id', 'author', 'text'],
    },
  },
  {
    name: 'delete_ticket',
    description: 'Permanently delete a ticket.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Ticket ID.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'add_blocker',
    description: 'Mark ticket B as blocked by ticket A (A must complete before B can start). The ticket is automatically moved to "blocked" column.',
    inputSchema: {
      type: 'object',
      properties: {
        id:        { type: 'string', description: 'Ticket ID to block (the dependent).' },
        blocker_id: { type: 'string', description: 'Ticket ID that must complete first (the dependency).' },
      },
      required: ['id', 'blocker_id'],
    },
  },
  {
    name: 'remove_blocker',
    description: 'Remove a blocker from a ticket. If all blockers are removed, move it back to "ready".',
    inputSchema: {
      type: 'object',
      properties: {
        id:        { type: 'string', description: 'Ticket ID.' },
        blocker_id: { type: 'string', description: 'Blocker ticket ID to remove.' },
      },
      required: ['id', 'blocker_id'],
    },
  },
];

/** Every tool this module offers. The one list, so nothing drifts. */
export const KANBAN_TOOL_NAMES: readonly string[] = kanbanTools().map((t) => t.name);
