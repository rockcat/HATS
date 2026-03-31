import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { KanbanStore } from './store.js';
import { Column, Priority } from './types.js';

const COLUMNS: Column[] = ['backlog', 'ready', 'in_progress', 'blocked', 'completed'];
const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'critical'];

export async function startKanbanServer(boardPath: string): Promise<void> {
  const store = new KanbanStore(boardPath);
  await store.load();

  const server = new Server(
    { name: 'kanban', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  // ── Tool list ──────────────────────────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
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
        description: 'Move a ticket to a different column.',
        inputSchema: {
          type: 'object',
          properties: {
            id:     { type: 'string', description: 'Ticket ID.' },
            column: { type: 'string', enum: COLUMNS, description: 'Destination column.' },
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
            title:       { type: 'string' },
            description: { type: 'string' },
            priority:    { type: 'string', enum: PRIORITIES },
            tags:        { type: 'array', items: { type: 'string' } },
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
    ],
  }));

  // ── Tool handlers ──────────────────────────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;

    try {
      const result = await handleTool(name, args as Record<string, unknown>, store);
      return {
        content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function handleTool(name: string, args: Record<string, unknown>, store: KanbanStore): Promise<unknown> {
  switch (name) {
    case 'get_board':
      return store.getBoardSummary();

    case 'create_ticket': {
      const title = (args['title'] as string | undefined)?.trim();
      if (!title) throw new Error('title is required and cannot be empty');
      const ticket = await store.createTicket({
        title,
        description: args['description'] as string,
        priority:    args['priority'] as Priority | undefined,
        creator:     args['creator'] as string,
        assignee:    args['assignee'] as string | undefined,
        tags:        args['tags'] as string[] | undefined,
      });
      return `Created ${ticket.id}: "${ticket.title}" in backlog.`;
    }

    case 'get_ticket': {
      const ticket = store.getTicket(args['id'] as string);
      if (!ticket) throw new Error(`Ticket "${args['id']}" not found`);
      return ticket;
    }

    case 'list_tickets':
      return store.listTickets({
        column:   args['column'] as Column | undefined,
        assignee: args['assignee'] as string | undefined,
        tag:      args['tag'] as string | undefined,
      });

    case 'move_ticket': {
      const ticket = await store.moveTicket(args['id'] as string, args['column'] as Column);
      return `Moved ${ticket.id} to "${ticket.column}".`;
    }

    case 'assign_ticket': {
      const ticket = await store.assignTicket(args['id'] as string, args['assignee'] as string);
      return `Assigned ${ticket.id} to ${ticket.assignee}.`;
    }

    case 'update_ticket': {
      const ticket = await store.updateTicket(args['id'] as string, {
        title:       args['title'] as string | undefined,
        description: args['description'] as string | undefined,
        priority:    args['priority'] as Priority | undefined,
        tags:        args['tags'] as string[] | undefined,
      });
      return `Updated ${ticket.id}.`;
    }

    case 'add_comment': {
      const ticket = await store.addComment(
        args['id'] as string,
        args['author'] as string,
        args['text'] as string,
      );
      return `Comment added to ${ticket.id}.`;
    }

    case 'delete_ticket':
      await store.deleteTicket(args['id'] as string);
      return `Deleted ${args['id']}.`;

    case 'add_blocker': {
      const ticket = await store.addBlocker(args['id'] as string, args['blocker_id'] as string);
      return `${ticket.id} is now blocked by ${args['blocker_id']}. blockedBy: [${(ticket.blockedBy ?? []).join(', ')}]`;
    }

    case 'remove_blocker': {
      const ticket = await store.removeBlocker(args['id'] as string, args['blocker_id'] as string);
      const remaining = ticket.blockedBy ?? [];
      return remaining.length === 0
        ? `Removed blocker from ${ticket.id}. All blockers cleared — ticket is now ready.`
        : `Removed blocker from ${ticket.id}. Remaining blockers: [${remaining.join(', ')}]`;
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// Entry point when run as a subprocess by the MCP client
const _boardPath = process.env['KANBAN_BOARD_PATH'] ?? process.argv[2] ?? 'kanban-board.json';
startKanbanServer(_boardPath).catch(console.error);
