import { describe, it, expect } from 'vitest';
import { savedServerForHere } from './team-assembler.js';
import type { MCPServerDef } from '../mcp/mcp-client.js';

const stdio = (name: string, args: string[]) =>
  ({ name, config: { transport: 'stdio', command: 'node', args } }) as MCPServerDef;

describe('a saved shared server, made to run here', () => {
  it('drops the board server older projects still list: the board runs inside the runner', () => {
    expect(savedServerForHere(stdio('kanban', ['dist/mcp/kanban/server.js', 'board.json']))).toBeNull();
  });

  it('repoints one of our own servers at where it is now', () => {
    const def = savedServerForHere(stdio('calendar', ['dist/calendar/server.js']));
    const args = (def!.config as { args: string[] }).args;
    expect(args.some((a) => a.includes('dist/calendar'))).toBe(false);
    expect(args.some((a) => /calendar[\\/]server\.(ts|js)$/.test(a))).toBe(true);
  });

  it('keeps anyone else\'s server as it was saved', () => {
    const saved = { name: 'brave-search', config: { transport: 'stdio', command: 'npx', args: ['-y', 'brave'] } } as MCPServerDef;
    expect((savedServerForHere(saved)!.config as { args: string[] }).args).toEqual(['-y', 'brave']);
  });
});
