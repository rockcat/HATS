import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { KanbanStore } from './store.js';
import { handleKanbanCall, kanbanTools } from './tools.js';
import { log } from '../../../../packages/core/src/logger.js';


export async function startKanbanServer(boardPath: string): Promise<void> {
  const store = new KanbanStore(boardPath);
  await store.load();

  const server = new Server(
    { name: 'kanban', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  // ── Tool list ──────────────────────────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: kanbanTools(),
  }));

  // ── Tool handlers ──────────────────────────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;

    try {
      const result = await handleKanbanCall(name, args as Record<string, unknown>, store);
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


// Entry point when run directly (not when imported by kanban-mcp.ts)
import { pathToFileURL } from 'url';
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const _boardPath = process.env['KANBAN_BOARD_PATH'] ?? process.argv[2] ?? 'kanban-board.json';
  startKanbanServer(_boardPath).catch(e => log.error(e));
}
