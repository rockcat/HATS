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
import { kanbanTools, KANBAN_TOOL_NAMES, UPFRONT_KANBAN_TOOLS, type KanbanTool } from '../../../../packages/core/src/tools/kanban.js';

export { kanbanTools, KANBAN_TOOL_NAMES, UPFRONT_KANBAN_TOOLS, type KanbanTool };


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
      // Models reach for ticket_id as often as id; answering "undefined not
      // found" sends them round again with the same mistake.
      const id = (args['id'] ?? args['ticket_id'] ?? args['ticket']) as string | undefined;
      if (!id) throw new Error('id is required, e.g. { "id": "TKT-001" }');
      const ticket = await store.getTicket(id);
      if (!ticket) throw new Error(`Ticket "${id}" not found`);
      // Closed tickets stay off the board, but "not found" for one that
      // existed reads as a fault, and agents retried it.
      if (ticket.column === 'closed') {
        return `${ticket.id} "${ticket.title}" is closed (${ticket.closedReason ?? 'completed'}). `
          + 'There is nothing left to do on it.';
      }
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
