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
    ],
  }));

  // ── Tool handlers ──────────────────────────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;

    try {
      const result = handleTool(name, args as Record<string, unknown>, store);
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

function handleTool(name: string, args: Record<string, unknown>, store: KanbanStore): unknown {
  switch (name) {
    case 'get_board':
      return store.getBoardSummary();

    case 'create_ticket': {
      const title = (args['title'] as string | undefined)?.trim();
      if (!title) throw new Error('title is required and cannot be empty');
      const ticket = store.createTicket({
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
      const ticket = store.moveTicket(args['id'] as string, args['column'] as Column);
      return `Moved ${ticket.id} to "${ticket.column}".`;
    }

    case 'assign_ticket': {
      const ticket = store.assignTicket(args['id'] as string, args['assignee'] as string);
      return `Assigned ${ticket.id} to ${ticket.assignee}.`;
    }

    case 'update_ticket': {
      const ticket = store.updateTicket(args['id'] as string, {
        title:       args['title'] as string | undefined,
        description: args['description'] as string | undefined,
        priority:    args['priority'] as Priority | undefined,
        tags:        args['tags'] as string[] | undefined,
      });
      return `Updated ${ticket.id}.`;
    }

    case 'add_comment': {
      const ticket = store.addComment(
        args['id'] as string,
        args['author'] as string,
        args['text'] as string,
      );
      return `Comment added to ${ticket.id}.`;
    }

    case 'delete_ticket':
      store.deleteTicket(args['id'] as string);
      return `Deleted ${args['id']}.`;

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
