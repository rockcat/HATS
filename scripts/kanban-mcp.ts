#!/usr/bin/env node
/**
 * Kanban MCP server — runs as a stdio subprocess.
 *
 * Usage (standalone):
 *   node --import tsx/esm scripts/kanban-mcp.ts [board-file]
 *
 * Board file defaults to ./kanban-board.json
 * The orchestrator connects via StdioClientTransport automatically.
 */

import * as path from 'path';
import { startKanbanServer } from '../src/mcp/kanban/server.js';

const boardPath = process.argv[2] ?? path.join(process.cwd(), 'kanban-board.json');
startKanbanServer(boardPath).catch((err) => {
  console.error('[kanban-mcp]', err);
  process.exit(1);
});
