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

/**
 * Write a consistent copy of a project's database to `dest`.
 *
 * Copying project.db itself would miss whatever is still in the WAL, and the
 * WAL of a running project is rarely empty.
 */
export function snapshotProjectDb(dbPath: string, dest: string): void {
  const wasOpen = open.has(dbPath);
  const db = openProjectDb(dbPath);
  try {
    db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  } finally {
    if (!wasOpen) closeProjectDb(dbPath);
  }
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

/**
 * Add a column to a table that may predate it. `CREATE TABLE IF NOT EXISTS`
 * leaves an existing table alone, so a column added later needs this too.
 */
export function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>;
  if (!columns.some(c => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

/** Is this table empty? */
export function isEmpty(db: DatabaseSync, table: string): boolean {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return row.n === 0;
}

/**
 * Has this legacy file already been imported?
 *
 * Recorded, rather than inferred from the table being empty. Emptiness is
 * the wrong signal and fails in a nasty way: delete the last ticket on a
 * board and the table is empty again, so the next open re-imports the old
 * JSON and the ticket comes back from the dead. An event log that was
 * deliberately cleared would refill itself the same way.
 */
export function hasImported(db: DatabaseSync, what: string): boolean {
  db.exec('CREATE TABLE IF NOT EXISTS imported (what TEXT PRIMARY KEY, at TEXT NOT NULL)');
  return db.prepare('SELECT 1 FROM imported WHERE what = ?').get(what) !== undefined;
}

/** Record that it has, so it never happens twice. */
export function markImported(db: DatabaseSync, what: string): void {
  db.exec('CREATE TABLE IF NOT EXISTS imported (what TEXT PRIMARY KEY, at TEXT NOT NULL)');
  db.prepare('INSERT OR REPLACE INTO imported (what, at) VALUES (?, ?)')
    .run(what, new Date().toISOString());
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
