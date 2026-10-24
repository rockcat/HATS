import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { DatabaseSync } from 'node:sqlite';
import {
  dbPathFor, ensureSchema, hasImported, inTransaction, markImported, openProjectDb,
} from './project-db.js';

export interface StoredEvent {
  id: string;
  ts: string;
  type: string;
  [key: string]: unknown;
}

/**
 * Every agent action, message, meeting turn and decision, in order.
 *
 * This was a JSONL file, which is an excellent thing to append to and a poor
 * thing to ask questions of. readSince() read the whole log and filtered it
 * in memory — on paige, 28MB parsed to return a handful of rows, every time
 * anything asked what had happened lately. It is a table with an index on
 * `ts` now, and that query is a seek.
 *
 * The constructor still takes the path to team-events.jsonl, so no caller
 * changed. The database sits beside it, and the old file is imported once and
 * then left alone — not deleted, because a migration nobody can undo is one
 * nobody should have to trust.
 */
export class EventStore {
  private filePath: string;
  private db: DatabaseSync | null = null;
  private subscribers: Array<(event: StoredEvent) => void> = [];

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    this.db = openProjectDb(dbPathFor(this.filePath));
    ensureSchema(this.db, [
      `CREATE TABLE IF NOT EXISTS events (
         id      TEXT PRIMARY KEY,
         ts      TEXT NOT NULL,
         type    TEXT NOT NULL,
         payload TEXT NOT NULL
       )`,
      // The index readSince exists for. Without it the query is a scan, which
      // is what the JSONL version was doing by hand.
      'CREATE INDEX IF NOT EXISTS events_ts ON events (ts)',
      'CREATE INDEX IF NOT EXISTS events_type_ts ON events (type, ts)',
    ]);

    if (!hasImported(this.db, 'team-events.jsonl')) {
      await this.importLegacy();
      markImported(this.db, 'team-events.jsonl');
    }
  }

  /** Subscribe to every new event as it is appended. */
  subscribe(fn: (event: StoredEvent) => void): () => void {
    this.subscribers.push(fn);
    return () => { this.subscribers = this.subscribers.filter((s) => s !== fn); };
  }

  /** Append one event and return it (with generated id and timestamp). */
  append(type: string, payload: Record<string, unknown>): Promise<StoredEvent> {
    const event: StoredEvent = {
      id: uuidv4(),
      ts: new Date().toISOString(),
      type,
      ...payload,
    };

    // No write queue any more. The JSONL version needed one so two appends
    // could not interleave half a line; SQLite serialises writes itself.
    this.insert(event);

    for (const fn of this.subscribers) {
      try { fn(event); } catch { /* subscriber errors must not break the store */ }
    }

    return Promise.resolve(event);
  }

  /** Read all events (for replay / visualisation). */
  async readAll(): Promise<StoredEvent[]> {
    const rows = this.database()
      .prepare('SELECT id, ts, type, payload FROM events ORDER BY ts, rowid')
      .all() as unknown as EventRow[];
    return rows.map(toEvent);
  }

  /** Read events since a given ISO timestamp. */
  async readSince(since: string): Promise<StoredEvent[]> {
    const rows = this.database()
      .prepare('SELECT id, ts, type, payload FROM events WHERE ts > ? ORDER BY ts, rowid')
      .all(since) as unknown as EventRow[];
    return rows.map(toEvent);
  }

  /** How many events there are, without reading any of them. */
  count(): number {
    const row = this.database().prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number };
    return row.n;
  }

  private database(): DatabaseSync {
    if (!this.db) throw new Error('EventStore.init() has not been called.');
    return this.db;
  }

  private insert(event: StoredEvent): void {
    const { id, ts, type, ...rest } = event;
    this.database()
      .prepare('INSERT INTO events (id, ts, type, payload) VALUES (?, ?, ?, ?)')
      .run(id, ts, type, JSON.stringify(rest));
  }

  /**
   * Bring an existing team-events.jsonl into the table, once.
   *
   * A malformed line is skipped rather than fatal. These logs are months of
   * history, and a single truncated final line — a crash mid-append, which
   * the JSONL format allows — should not cost the other hundred thousand.
   */
  private async importLegacy(): Promise<void> {
    const text = await fs.readFile(this.filePath, 'utf-8').catch(() => '');
    if (!text.trim()) return;

    const db = this.database();
    const insert = db.prepare('INSERT OR IGNORE INTO events (id, ts, type, payload) VALUES (?, ?, ?, ?)');
    let imported = 0;
    let skipped = 0;

    inTransaction(db, () => {
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          const { id, ts, type, ...rest } = JSON.parse(line) as StoredEvent;
          insert.run(id ?? uuidv4(), ts, type, JSON.stringify(rest));
          imported++;
        } catch {
          skipped++;
        }
      }
    });

    // eslint-disable-next-line no-console
    console.log(`[Events] Imported ${imported} event(s) from ${path.basename(this.filePath)}`
      + `${skipped ? ` (${skipped} unreadable line(s) skipped)` : ''}`);
  }
}

interface EventRow { id: string; ts: string; type: string; payload: string }

function toEvent(row: EventRow): StoredEvent {
  return { id: row.id, ts: row.ts, type: row.type, ...JSON.parse(row.payload) as object };
}
