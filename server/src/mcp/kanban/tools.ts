// ── The kanban board, as tools ───────────────────────────────────────────────
//
// These used to be an MCP server in its own process, spawned over stdio with
// a path to the board. That cost a subprocess per project, and worse: the
// runner kept its own copy of the board-reading code and a file watcher to
// notice writes the other process made. Two writers, one JSON file, no
// locking — the shape that loses updates.
//
// They are ordinary in-process tools now. The watcher is gone because there
// is nothing left to watch, and KanbanStore is the only thing that touches
// the board.

import { KanbanStore } from './store.js';
import { ClosedReason, Column, Priority } from './types.js';
import type { ToolDefinition } from '../../providers/types.js';

const COLUMNS: Column[] = ['backlog', 'ready', 'in_progress', 'blocked', 'review', 'closed'];
const CLOSED_REASONS: ClosedReason[] = ['completed', 'cancelled'];
const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'critical'];

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

/** Run one of them. Separated from any transport so it can be tested. */
export async function handleKanbanCall(
  name: string, args: Record<string, unknown>, store: KanbanStore,
): Promise<unknown> {
  switch (name) {
    case 'get_board': {
      const board = await store.getBoardSummary();
      const { closed: _closed, ...visible } = board;
      return visible;
    }

    case 'create_ticket': {
      const title = (args['title'] as string | undefined)?.trim();
      if (!title) throw new Error('title is required and cannot be empty');
      const existing = store.findByTitle(title);
      if (existing) {
        return `Ticket already exists — ${existing.id}: "${existing.title}" (${existing.column}). No duplicate created.`;
      }
      const ticket = await store.createTicket({
        title,
        description: args['description'] as string,
        priority:    args['priority'] as Priority | undefined,
        creator:     args['creator'] as string,
        assignee:    args['assignee'] as string | undefined,
        tags:        args['tags'] as string[] | undefined,
        threadId:    args['thread_id'] as string | undefined,
      });
      return `Created ${ticket.id}: "${ticket.title}" in backlog.`;
    }

    case 'get_ticket': {
      const ticket = await store.getTicket(args['id'] as string);
      if (!ticket || ticket.column === 'closed') throw new Error(`Ticket "${args['id']}" not found`);
      return ticket;
    }

    case 'list_tickets': {
      const col = args['column'] as Column | undefined;
      if (col === 'closed') return [];
      const tickets = await store.listTickets({
        column:   col,
        assignee: args['assignee'] as string | undefined,
        tag:      args['tag'] as string | undefined,
      });
      return tickets.filter(t => t.column !== 'closed');
    }

    case 'move_ticket': {
      const id     = (args['id'] ?? args['ticket']) as string;
      const col    = args['column'] as Column;
      const reason = args['closed_reason'] as ClosedReason | undefined;
      const ticket = await store.moveTicket(id, col, reason);
      const suffix = ticket.closedReason ? ` (${ticket.closedReason})` : '';
      return `Moved ${ticket.id} to "${ticket.column}"${suffix}.`;
    }

    case 'assign_ticket': {
      const id       = (args['id']       ?? args['ticket'])   as string;
      const assignee = (args['assignee'] ?? args['agent'])    as string;
      const ticket = await store.assignTicket(id, assignee);
      return `Assigned ${ticket.id} to ${ticket.assignee}.`;
    }

    case 'update_ticket': {
      const ticket = await store.updateTicket((args['id'] ?? args['ticket']) as string, {
        title:       args['title'] as string | undefined,
        description: args['description'] as string | undefined,
        priority:    args['priority'] as Priority | undefined,
        tags:        args['tags'] as string[] | undefined,
      });
      return `Updated ${ticket.id}.`;
    }

    case 'add_comment': {
      const ticket = await store.addComment(
        (args['id'] ?? args['ticket']) as string,
        args['author'] as string,
        args['text'] as string,
      );
      return `Comment added to ${ticket.id}.`;
    }

    case 'delete_ticket': {
      const id = (args['id'] ?? args['ticket']) as string;
      await store.deleteTicket(id);
      return `Deleted ${id}.`;
    }

    case 'add_blocker': {
      const ticket = await store.addBlocker((args['id'] ?? args['ticket']) as string, args['blocker_id'] as string);
      return `${ticket.id} is now blocked by ${args['blocker_id']}. blockedBy: [${(ticket.blockedBy ?? []).join(', ')}]`;
    }

    case 'remove_blocker': {
      const ticket = await store.removeBlocker((args['id'] ?? args['ticket']) as string, args['blocker_id'] as string);
      const remaining = ticket.blockedBy ?? [];
      return remaining.length === 0
        ? `Removed blocker from ${ticket.id}. All blockers cleared — ticket is now ready.`
        : `Removed blocker from ${ticket.id}. Remaining blockers: [${remaining.join(', ')}]`;
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
