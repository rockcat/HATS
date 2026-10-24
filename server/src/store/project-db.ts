// ── One database per project ─────────────────────────────────────────────────
//
// `<projectDir>/project.db`, holding the things that grow: the event log,
// telemetry, the board, and the requests waiting on a person. The documents
// that stay a fixed size — team state, the agenda, the allowlist — remain
// JSON beside it, where they can still be opened and read.
//
// One file per project rather than one for everything, so copying a folder is
// still copying a project and deleting one still deletes it.
//
// node:sqlite is built into Node, which is why this costs no native
// dependency and no node-gyp in the image build. It is flagged experimental
// and its API may move between minors, so it is confined to this file and the
// four stores — nothing else imports it.

import { DatabaseSync } from 'node:sqlite';
import * as path from 'path';

/**
 * Open connections, keyed by file.
 *
 * Four stores share a project's database and must share its connection:
 * separate handles to one SQLite file are a lock contention problem with no
 * upside, and WAL only makes it survivable rather than sensible.
 */
const open = new Map<string, DatabaseSync>();

/** Where a project's database lives, given any file inside the project. */
export function dbPathFor(fileInProject: string): string {
  return path.join(path.dirname(fileInProject), 'project.db');
}

/** Open (or reuse) the database for a project. */
export function openProjectDb(dbPath: string): DatabaseSync {
  const existing = open.get(dbPath);
  if (existing) return existing;

  const db = new DatabaseSync(dbPath);

  // WAL so a reader never blocks the writer. Single-process today, but the
  // cost is nil and the failure it prevents — a read throwing SQLITE_BUSY
  // mid-request — is tedious to diagnose.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  // NORMAL rather than FULL: an event log that loses its last few rows in a
  // power cut is acceptable; waiting for fsync on every append is not.
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');

  open.set(dbPath, db);
  return db;
}

/** Close a project's database. Called when switching project. */
export function closeProjectDb(dbPath: string): void {
  const db = open.get(dbPath);
  if (!db) return;
  try { db.close(); } catch { /* already closed */ }
  open.delete(dbPath);
}

/** Close everything. For shutdown, and for tests that must not leak handles. */
export function closeAllProjectDbs(): void {
  for (const dbPath of [...open.keys()]) closeProjectDb(dbPath);
}

/**
 * Create a table and its indexes once.
 *
 * Plain `IF NOT EXISTS` rather than a migration framework: these tables are
 * append-mostly and owned by one store each, and a version table would be
 * ceremony around a schema that has never changed.
 */
export function ensureSchema(db: DatabaseSync, statements: string[]): void {
  for (const statement of statements) db.exec(statement);
}

/** Is this table empty? Used to decide whether a legacy file needs importing. */
export function isEmpty(db: DatabaseSync, table: string): boolean {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return row.n === 0;
}

/**
 * Run a batch of writes as one transaction.
 *
 * Importing a 28MB event log row by row without this takes minutes: SQLite
 * commits each statement separately otherwise, and that is one fsync apiece.
 */
export function inTransaction(db: DatabaseSync, work: () => void): void {
  db.exec('BEGIN');
  try {
    work();
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* the failure above is the real one */ }
    throw err;
  }
}
