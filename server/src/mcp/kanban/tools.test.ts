// The board as tools, rather than as a subprocess.
//
// What is worth testing here is the seam, not the board: that every tool the
// agent is offered can actually be dispatched, that the upfront set is the
// handful worth spending prompt on, and that the schemas say enough for a
// model to use them. The board's own behaviour is store.test.ts's job.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { KanbanStore } from './store.js';
import { closeAllProjectDbs } from '../../store/project-db.js';
import {
  KANBAN_TOOL_NAMES, UPFRONT_KANBAN_TOOLS, handleKanbanCall, kanbanTools,
} from './tools.js';

let dir: string;
let store: KanbanStore;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'hats-kanban-tools-'));
  store = new KanbanStore(path.join(dir, 'kanban-board.json'));
  await store.load();
});

afterEach(async () => {
  // The board lives in the project database now, and Windows will not remove
  // a file while a handle is open on it.
  closeAllProjectDbs();
  await rm(dir, { recursive: true, force: true });
});

const call = (name: string, args: Record<string, unknown> = {}) =>
  handleKanbanCall(name, args, store);

/**
 * Make a ticket and return its id.
 *
 * create_ticket answers with a sentence for the model to read — "Created
 * TKT-001: … in backlog." — rather than the ticket, so the id has to be
 * read back out of it.
 */
async function makeTicket(title: string): Promise<string> {
  const said = await call('create_ticket', {
    title, description: 'something to do', creator: 'Poppy',
  }) as string;
  const id = /TKT-\d+/.exec(said)?.[0];
  if (!id) throw new Error(`no ticket id in: ${said}`);
  return id;
}

describe('what the agent is offered', () => {
  it('offers eleven tools', () => {
    expect(kanbanTools()).toHaveLength(11);
  });

  it('names every one of them in KANBAN_TOOL_NAMES', () => {
    // The executor routes on that list, so a tool missing from it is offered
    // to the model and then reported as unknown when it is called.
    expect([...KANBAN_TOOL_NAMES].sort()).toEqual(kanbanTools().map((t) => t.name).sort());
  });

  it('can dispatch every tool it offers', async () => {
    // The failure this catches: a tool in the list with no case in the
    // switch. As an MCP server that was a runtime error in a subprocess
    // whose logs nobody was reading.
    //
    // Called with no arguments, so most of these fail — that is fine and
    // expected. What must not happen is falling through to "Unknown tool",
    // which is the only answer that means the wiring is wrong rather than
    // the arguments.
    const unreachable: string[] = [];
    for (const tool of kanbanTools()) {
      try {
        await call(tool.name, {});
      } catch (err) {
        if (/Unknown tool/.test((err as Error).message)) unreachable.push(tool.name);
      }
    }
    expect(unreachable).toEqual([]);
  });

  it('gives every property a description', () => {
    // A model reading `{type: 'string'}` has nothing to go on. This was not
    // true of update_ticket before the move.
    for (const tool of kanbanTools()) {
      for (const [field, schema] of Object.entries(tool.inputSchema.properties ?? {})) {
        expect((schema as { description?: string }).description, `${tool.name}.${field}`)
          .toBeTruthy();
      }
    }
  });
});

describe('which tools are worth prompt space', () => {
  it('puts the hot path upfront', () => {
    expect([...UPFRONT_KANBAN_TOOLS].sort())
      .toEqual(['create_ticket', 'get_board', 'list_tickets', 'move_ticket']);
  });

  it('leaves the occasional ones to tool search', () => {
    const searchable = kanbanTools()
      .map((t) => t.name)
      .filter((n) => !(UPFRONT_KANBAN_TOOLS as readonly string[]).includes(n));
    expect(searchable).toHaveLength(7);
    expect(searchable).toContain('add_blocker');
    expect(searchable).toContain('delete_ticket');
  });

  it('only names tools that exist', () => {
    // A typo here is silent: the tool would simply never be offered upfront.
    for (const name of UPFRONT_KANBAN_TOOLS) {
      expect(KANBAN_TOOL_NAMES, name).toContain(name);
    }
  });
});

describe('running them', () => {
  it('creates a ticket and finds it on the board', async () => {
    await call('create_ticket', {
      title: 'Fix the thing', description: 'It is broken', creator: 'Poppy',
    });

    const board = await call('get_board') as Record<string, { count: number }>;
    expect(board['backlog']?.count).toBe(1);
  });

  it('moves a ticket across columns', async () => {
    const id = await makeTicket('Ship it');

    await call('move_ticket', { id, column: 'in_progress' });
    const after = await call('get_ticket', { id }) as { column: string };
    expect(after.column).toBe('in_progress');
  });

  it('answers in prose, not objects, for the tools a model reads', async () => {
    // The dispatcher returns a sentence for some tools and data for others,
    // and the executor stringifies whatever it gets. Worth pinning, because
    // a model told "[object Object]" has been told nothing.
    expect(await call('create_ticket', {
      title: 'Readable', description: 'x', creator: 'Poppy',
    })).toMatch(/^Created TKT-\d+/);
  });

  it('lists by column', async () => {
    await call('create_ticket', { title: 'A', description: 'a', creator: 'Poppy' });
    const ready = await call('list_tickets', { column: 'ready' }) as unknown[];
    expect(ready).toHaveLength(0);
  });

  it('says which tool it did not recognise', async () => {
    await expect(call('make_tea')).rejects.toThrow(/Unknown tool: make_tea/);
  });
});
