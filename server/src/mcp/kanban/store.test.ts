// The board, now rows rather than a JSON document.
//
// The round trip is what matters: a ticket has optional fields, comments and
// blockers, and every one of them has to survive being written to three
// tables and read back. A field that quietly stops persisting looks exactly
// like an agent forgetting something.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'os';
import * as path from 'path';
import { KanbanStore } from './store.js';
import { closeAllProjectDbs } from '../../store/project-db.js';

let dir: string;
let boardPath: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'hats-kanban-store-'));
  boardPath = path.join(dir, 'kanban-board.json');
});

afterEach(async () => {
  closeAllProjectDbs();
  await rm(dir, { recursive: true, force: true });
});

const freshStore = async () => {
  const store = new KanbanStore(boardPath);
  await store.load();
  return store;
};

/** Close and reopen, so we are reading rows rather than the in-memory board. */
const reopen = async () => {
  closeAllProjectDbs();
  return freshStore();
};

const make = (store: KanbanStore, over: Record<string, unknown> = {}) =>
  store.createTicket({
    title: 'Something', description: 'to do', creator: 'Poppy', ...over,
  } as Parameters<KanbanStore['createTicket']>[0]);

describe('a ticket survives the round trip', () => {
  it('keeps the plain fields', async () => {
    const store = await freshStore();
    const made = await make(store, { title: 'Fix it', description: 'properly', priority: 'high' });

    const after = await (await reopen()).getTicket(made.id);
    expect(after).toMatchObject({
      id: made.id, title: 'Fix it', description: 'properly',
      priority: 'high', column: 'backlog', creator: 'Poppy',
    });
  });

  it('keeps tags, which are a list inside one column', async () => {
    const store = await freshStore();
    const made = await make(store, { tags: ['infra', 'urgent'] });

    expect((await (await reopen()).getTicket(made.id))!.tags).toEqual(['infra', 'urgent']);
  });

  it('keeps comments, and their order', async () => {
    const store = await freshStore();
    const made = await make(store);
    await store.addComment(made.id, 'Poppy', 'first');
    await store.addComment(made.id, 'Rhoda', 'second');

    const after = await (await reopen()).getTicket(made.id);
    expect(after!.comments.map((c) => c.text)).toEqual(['first', 'second']);
    expect(after!.comments[0]!.author).toBe('Poppy');
  });

  it('keeps blockers', async () => {
    const store = await freshStore();
    const a = await make(store, { title: 'A' });
    const b = await make(store, { title: 'B' });
    await store.addBlocker(b.id, a.id);

    expect((await (await reopen()).getTicket(b.id))!.blockedBy).toEqual([a.id]);
  });

  it('leaves absent optional fields absent rather than null', async () => {
    // They come back from SQL as null, and a ticket with assignee: null is
    // not the same as one without an assignee.
    const store = await freshStore();
    const made = await make(store);

    const after = await (await reopen()).getTicket(made.id);
    expect(after!.assignee).toBeUndefined();
    expect(after!.closedReason).toBeUndefined();
  });

  it('always gives blockedBy an array, never undefined', async () => {
    // The exception to the rule above, deliberately. Rows cannot distinguish
    // "no blockers" from "the key was never there", and several call sites
    // do `ticket.blockedBy!.filter(...)` — fine on an empty array, a crash
    // on undefined. The invariant is worth more than the fidelity.
    const store = await freshStore();
    const made = await make(store);

    expect((await (await reopen()).getTicket(made.id))!.blockedBy).toEqual([]);
  });

  it('keeps the dispatch fields an agent needs on re-dispatch', async () => {
    const store = await freshStore();
    const made = await make(store, { threadId: 'thread-7' });
    await store.updateTicket(made.id, {});

    expect((await (await reopen()).getTicket(made.id))!.threadId).toBe('thread-7');
  });
});

describe('mutations persist', () => {
  it('a move', async () => {
    const store = await freshStore();
    const made = await make(store);
    await store.moveTicket(made.id, 'in_progress');

    expect((await (await reopen()).getTicket(made.id))!.column).toBe('in_progress');
  });

  it('a close, with its reason', async () => {
    const store = await freshStore();
    const made = await make(store);
    await store.moveTicket(made.id, 'closed', 'cancelled');

    const after = await (await reopen()).getTicket(made.id);
    expect(after!.column).toBe('closed');
    expect(after!.closedReason).toBe('cancelled');
  });

  it('an assignment', async () => {
    const store = await freshStore();
    const made = await make(store);
    await store.assignTicket(made.id, 'Rhoda');

    expect((await (await reopen()).getTicket(made.id))!.assignee).toBe('Rhoda');
  });

  it('a deletion, and takes the comments with it', async () => {
    const store = await freshStore();
    const made = await make(store);
    await store.addComment(made.id, 'Poppy', 'note');
    await store.deleteTicket(made.id);

    const second = await reopen();
    expect(await second.getTicket(made.id)).toBeUndefined();
    expect(await second.listTickets()).toHaveLength(0);
  });

  it('the long-running flag, set and cleared', async () => {
    const store = await freshStore();
    const made = await make(store, { longRunning: true });
    expect((await (await reopen()).getTicket(made.id))!.longRunning).toBe(true);

    await (await freshStore()).updateTicket(made.id, { longRunning: false });
    expect((await (await reopen()).getTicket(made.id))!.longRunning).toBeUndefined();
  });

  it('an update leaves the fields it was not given alone', async () => {
    const store = await freshStore();
    const made = await make(store, { tags: ['a'] });
    await store.updateTicket(made.id, { title: undefined, tags: undefined, longRunning: true });

    const after = await (await reopen()).getTicket(made.id);
    expect(after!.title).toBe('Something');
    expect(after!.tags).toEqual(['a']);
  });

  it('keeps the id sequence across a restart', async () => {
    const store = await freshStore();
    const first = await make(store);
    expect(first.id).toBe('TKT-001');

    const second = await reopen();
    const next = await make(second, { title: 'Another' });
    expect(next.id).toBe('TKT-002');
  });
});

describe('importing an existing board', () => {
  const legacy = (tickets: object, nextSeq = 3) =>
    JSON.stringify({ tickets, nextSeq }, null, 2);

  it('brings a kanban-board.json in on first open', async () => {
    await writeFile(boardPath, legacy({
      'TKT-001': {
        id: 'TKT-001', title: 'Old one', description: 'from before',
        priority: 'medium', column: 'ready', creator: 'Poppy', tags: ['x'],
        comments: [{ id: 'c1', author: 'Rhoda', text: 'hi', ts: '2026-01-01T00:00:00.000Z' }],
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      },
    }));

    const store = await freshStore();
    const ticket = await store.getTicket('TKT-001');
    expect(ticket!.title).toBe('Old one');
    expect(ticket!.comments).toHaveLength(1);
    expect(ticket!.tags).toEqual(['x']);
  });

  it('continues the imported sequence', async () => {
    await writeFile(boardPath, legacy({}, 7));
    const store = await freshStore();
    expect((await make(store)).id).toBe('TKT-007');
  });

  it('leaves the original file alone', async () => {
    await writeFile(boardPath, legacy({}));
    await freshStore();
    expect(existsSync(boardPath)).toBe(true);
  });

  it('imports once, not on every open', async () => {
    await writeFile(boardPath, legacy({
      'TKT-001': {
        id: 'TKT-001', title: 'One', description: '', priority: 'low',
        column: 'backlog', creator: 'P', tags: [], comments: [],
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      },
    }));

    const store = await freshStore();
    await store.deleteTicket('TKT-001');

    // Re-importing would resurrect it.
    expect(await (await reopen()).listTickets()).toHaveLength(0);
  });

  it('refuses a corrupt board rather than starting empty', async () => {
    // One JSON document, so a parse failure means every ticket. Starting
    // empty would look exactly like somebody deleting the lot.
    await writeFile(boardPath, '{"tickets": {"TKT-001": ');
    const store = new KanbanStore(boardPath);
    await expect(store.load()).rejects.toThrow(/could not be read/);
    expect(existsSync(boardPath)).toBe(true);
  });

  it('starts empty when there is no old board', async () => {
    const store = await freshStore();
    expect(await store.listTickets()).toEqual([]);
  });
});

describe('where the board lives', () => {
  it('goes in the project database, not its own file', async () => {
    const store = await freshStore();
    await make(store);

    expect(existsSync(path.join(dir, 'project.db'))).toBe(true);
    // Nothing writes the JSON any more.
    expect(existsSync(boardPath)).toBe(false);
  });
});

describe('a database from before the long-running flag', () => {
  it('gains the column and keeps its tickets', async () => {
    const store = await freshStore();
    const made = await make(store);
    closeAllProjectDbs();

    const db = new DatabaseSync(path.join(dir, 'project.db'));
    db.exec('ALTER TABLE tickets DROP COLUMN longRunning');
    db.close();

    const after = await freshStore();
    expect((await after.getTicket(made.id))!.title).toBe('Something');
    await after.updateTicket(made.id, { longRunning: true });
    expect((await (await reopen()).getTicket(made.id))!.longRunning).toBe(true);
  });
});
