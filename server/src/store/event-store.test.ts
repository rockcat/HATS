// The event log, now a table.
//
// Two things matter beyond "it stores things": that an existing JSONL log is
// imported without loss, and that readSince actually filters in the database
// rather than reading everything and discarding most of it. The second is the
// whole reason for the change.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { EventStore } from './event-store.js';
import { closeAllProjectDbs } from './project-db.js';

let dir: string;
let logPath: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'hats-events-'));
  logPath = path.join(dir, 'team-events.jsonl');
});

afterEach(async () => {
  closeAllProjectDbs();
  await rm(dir, { recursive: true, force: true });
});

const freshStore = async () => {
  const store = new EventStore(logPath);
  await store.init();
  return store;
};

describe('appending', () => {
  it('gives every event an id and a timestamp', async () => {
    const store = await freshStore();
    const event = await store.append('agent_message', { agent: 'Poppy', content: 'hello' });

    expect(event.id).toBeTruthy();
    expect(event.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(event.type).toBe('agent_message');
    expect(event['agent']).toBe('Poppy');
  });

  it('keeps arbitrary payload fields', async () => {
    const store = await freshStore();
    await store.append('tool_call', { agent: 'Rhoda', tool: 'get_board', args: { a: 1 } });

    const [event] = await store.readAll();
    expect(event!['tool']).toBe('get_board');
    expect(event!['args']).toEqual({ a: 1 });
  });

  it('keeps them in order', async () => {
    const store = await freshStore();
    for (const n of [1, 2, 3, 4, 5]) await store.append('tick', { n });

    const all = await store.readAll();
    expect(all.map((e) => e['n'])).toEqual([1, 2, 3, 4, 5]);
  });

  it('orders events written within the same millisecond', async () => {
    // Timestamps are ISO strings to the millisecond, so a burst shares one.
    // Ordering by ts alone would leave them in whatever order SQLite felt
    // like — hence the tiebreak on rowid.
    const store = await freshStore();
    await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map((n) => store.append('burst', { n })));

    const all = await store.readAll();
    expect(all.map((e) => e['n'])).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('tells subscribers as it goes', async () => {
    const store = await freshStore();
    const seen: string[] = [];
    store.subscribe((e) => seen.push(e.type));

    await store.append('one', {});
    await store.append('two', {});
    expect(seen).toEqual(['one', 'two']);
  });

  it('survives a subscriber that throws', async () => {
    const store = await freshStore();
    store.subscribe(() => { throw new Error('badly behaved'); });

    await expect(store.append('still_fine', {})).resolves.toBeTruthy();
    expect(await store.count()).toBe(1);
  });
});

describe('reading since a time', () => {
  it('returns only what came after', async () => {
    const store = await freshStore();
    await store.append('old', {});
    const cut = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 5));
    await store.append('new', {});

    const since = await store.readSince(cut);
    expect(since.map((e) => e.type)).toEqual(['new']);
  });

  it('filters in the database, not in memory', async () => {
    // The point of the change. readSince used to call readAll and filter the
    // result, so asking for the last few rows parsed the entire log.
    const store = await freshStore();
    for (let n = 0; n < 500; n++) await store.append('noise', { n });
    const cut = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 5));
    await store.append('wanted', {});

    const since = await store.readSince(cut);
    expect(since).toHaveLength(1);
    expect(await store.count()).toBe(501);
  });

  it('returns nothing for a time in the future', async () => {
    const store = await freshStore();
    await store.append('past', {});
    const later = new Date(Date.now() + 60_000).toISOString();
    expect(await store.readSince(later)).toEqual([]);
  });
});

describe('importing an existing log', () => {
  const lines = (...events: object[]) => events.map((e) => JSON.stringify(e)).join('\n') + '\n';

  it('brings a JSONL log in on first open', async () => {
    await writeFile(logPath, lines(
      { id: 'a', ts: '2026-01-01T00:00:00.000Z', type: 'agent_message', agent: 'Poppy' },
      { id: 'b', ts: '2026-01-02T00:00:00.000Z', type: 'tool_call', tool: 'get_board' },
    ));

    const store = await freshStore();
    const all = await store.readAll();
    expect(all.map((e) => e.id)).toEqual(['a', 'b']);
    expect(all[0]!['agent']).toBe('Poppy');
  });

  it('leaves the original file alone', async () => {
    // A migration nobody can undo is one nobody should have to trust.
    await writeFile(logPath, lines({ id: 'a', ts: '2026-01-01T00:00:00.000Z', type: 'x' }));
    await freshStore();

    expect(existsSync(logPath)).toBe(true);
    expect(await readFile(logPath, 'utf-8')).toContain('"id":"a"');
  });

  it('imports once, not on every open', async () => {
    await writeFile(logPath, lines({ id: 'a', ts: '2026-01-01T00:00:00.000Z', type: 'x' }));

    await freshStore();
    closeAllProjectDbs();
    const second = await freshStore();

    expect(await second.count()).toBe(1);
  });

  it('skips a truncated final line rather than losing the log', async () => {
    // A crash mid-append leaves exactly this, and the JSONL format allows it.
    await writeFile(logPath,
      lines(
        { id: 'a', ts: '2026-01-01T00:00:00.000Z', type: 'good' },
        { id: 'b', ts: '2026-01-02T00:00:00.000Z', type: 'also_good' },
      ) + '{"id":"c","ts":"2026-01-03T00:00:00.000Z","ty');

    const store = await freshStore();
    expect(await store.count()).toBe(2);
  });

  it('does nothing when there is no old log', async () => {
    const store = await freshStore();
    expect(await store.count()).toBe(0);
  });

  it('does not re-import over events already appended', async () => {
    await writeFile(logPath, lines({ id: 'a', ts: '2026-01-01T00:00:00.000Z', type: 'old' }));
    const store = await freshStore();
    await store.append('new', {});
    closeAllProjectDbs();

    const second = await freshStore();
    expect(await second.count()).toBe(2);
  });
});

describe('where the data lives', () => {
  it('puts the database beside the log it replaces', async () => {
    await freshStore();
    expect(existsSync(path.join(dir, 'project.db'))).toBe(true);
  });

  it('refuses to be used before init', async () => {
    const store = new EventStore(logPath);
    await expect(store.readAll()).rejects.toThrow(/init\(\) has not been called/);
  });
});
