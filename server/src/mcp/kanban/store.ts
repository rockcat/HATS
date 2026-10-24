import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { DatabaseSync } from 'node:sqlite';
import { Board, ClosedReason, Column, Comment, Priority, Ticket } from './types.js';
import {
  dbPathFor, ensureSchema, hasImported, inTransaction, markImported, openProjectDb,
} from '../../store/project-db.js';

const EMPTY_BOARD: Board = { tickets: {}, nextSeq: 1 };

export class KanbanStore {
  private board: Board = { tickets: {}, nextSeq: 1 };
  private filePath: string;
  private db: DatabaseSync | null = null;
  /** Serialises all mutating operations so concurrent creates never share a seq number. */
  private opQueue: Promise<void> = Promise.resolve();

  private serialise<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.opQueue.then(() => fn());
    // Swallow errors so one failed op doesn't jam the queue
    this.opQueue = p.then(() => undefined, () => undefined);
    return p;
  }

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    this.db = openProjectDb(dbPathFor(this.filePath));
    ensureSchema(this.db, [
      // "column" is reserved in SQL, so the ticket's column is stored as
      // col and mapped on the way in and out. Quoting it everywhere instead
      // would work right up until somebody forgot a quote.
      `CREATE TABLE IF NOT EXISTS tickets (
         id            TEXT PRIMARY KEY,
         title         TEXT NOT NULL,
         description   TEXT NOT NULL,
         priority      TEXT NOT NULL,
         col           TEXT NOT NULL,
         creator       TEXT NOT NULL,
         assignee      TEXT,
         tags          TEXT NOT NULL DEFAULT '[]',
         createdAt     TEXT NOT NULL,
         updatedAt     TEXT NOT NULL,
         closedReason  TEXT,
         projectName   TEXT,
         projectFolder TEXT,
         lastTaskId    TEXT,
         threadId      TEXT
       )`,
      `CREATE TABLE IF NOT EXISTS ticket_comments (
         id       TEXT PRIMARY KEY,
         ticketId TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
         author   TEXT NOT NULL,
         text     TEXT NOT NULL,
         ts       TEXT NOT NULL
       )`,
      `CREATE TABLE IF NOT EXISTS ticket_blockers (
         ticketId  TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
         blockerId TEXT NOT NULL,
         PRIMARY KEY (ticketId, blockerId)
       )`,
      'CREATE TABLE IF NOT EXISTS board_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
      'CREATE INDEX IF NOT EXISTS tickets_col ON tickets (col)',
      'CREATE INDEX IF NOT EXISTS tickets_assignee ON tickets (assignee)',
      'CREATE INDEX IF NOT EXISTS ticket_comments_ticket ON ticket_comments (ticketId)',
    ]);

    if (!hasImported(this.db, 'kanban-board.json')) {
      await this.importLegacy();
      markImported(this.db, 'kanban-board.json');
    }
    this.board = this.readBoard();
  }

  /**
   * Bring an existing kanban-board.json in, once.
   *
   * Unlike the event log, a corrupt board is fatal rather than skippable:
   * there is one JSON document, so a parse failure means the whole board.
   * Starting empty would look like someone deleted every ticket, so this
   * says what happened and leaves the file for a human to look at.
   */
  private async importLegacy(): Promise<void> {
    const raw = await fs.readFile(this.filePath, 'utf-8').catch(() => '');
    if (!raw.trim()) {
      this.board = structuredClone(EMPTY_BOARD);
      await this.persist();
      return;
    }

    let legacy: Board;
    try {
      legacy = JSON.parse(raw) as Board;
    } catch (err) {
      throw new Error(`${path.basename(this.filePath)} could not be read, so the `
        + `board has not been imported: ${(err as Error).message}. The file has `
        + 'been left alone.');
    }

    this.board = { tickets: legacy.tickets ?? {}, nextSeq: legacy.nextSeq ?? 1 };

    // Say which tickets were incomplete before defaulting them. persist()
    // fills the gaps so the import cannot fail, but a ticket that silently
    // acquires the title "(untitled)" should not be a surprise discovered
    // later on a board.
    const incomplete = Object.values(this.board.tickets)
      .filter((t) => t.title === undefined || t.description === undefined
        || t.priority === undefined || t.column === undefined)
      .map((t) => t.id);

    // Comments go the same way — paige has three with no author, and one of
    // those has no text either.
    const patchedComments = Object.values(this.board.tickets)
      .flatMap((t) => (t.comments ?? []).map((c) => ({ ticket: t.id, c })))
      .filter(({ c }) => c.author === undefined || c.text === undefined)
      .map(({ ticket }) => ticket);

    await this.persist();

    // eslint-disable-next-line no-console
    console.log(`[Kanban] Imported ${Object.keys(this.board.tickets).length} ticket(s) `
      + `from ${path.basename(this.filePath)}`
      + (incomplete.length
        ? `. ${incomplete.join(', ')} had missing fields and were given defaults.`
        : '')
      + (patchedComments.length
        ? ` Comments on ${[...new Set(patchedComments)].join(', ')} were missing`
          + ' an author or text.'
        : ''));
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  async getTicket(id: string): Promise<Ticket | undefined> {
    return this.board.tickets[id];
  }

  async listTickets(opts: { column?: Column; assignee?: string; tag?: string } = {}): Promise<Ticket[]> {
    return this._filterTickets(opts);
  }

  async getBoardSummary(): Promise<Record<Column, { count: number; tickets: Array<{ id: string; title: string; priority: Priority; assignee?: string }> }>> {
    const columns: Column[] = ['backlog', 'ready', 'in_progress', 'blocked', 'review', 'closed'];
    const result = {} as Awaited<ReturnType<typeof this.getBoardSummary>>;
    for (const col of columns) {
      const tickets = this._filterTickets({ column: col });
      result[col] = {
        count: tickets.length,
        tickets: tickets.map((t) => ({ id: t.id, title: t.title, priority: t.priority, assignee: t.assignee })),
      };
    }
    return result;
  }

  findByTitle(title: string): Ticket | undefined {
    const norm = title.trim().toLowerCase();
    return Object.values(this.board.tickets).find(t => t.title.toLowerCase() === norm);
  }

  private _filterTickets(opts: { column?: Column; assignee?: string; tag?: string } = {}): Ticket[] {
    return Object.values(this.board.tickets).filter((t) => {
      if (opts.column && t.column !== opts.column) return false;
      if (opts.assignee && t.assignee !== opts.assignee) return false;
      if (opts.tag && !t.tags.includes(opts.tag)) return false;
      return true;
    }).sort((a, b) => {
      const pri: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      return (pri[a.priority] - pri[b.priority]) || a.createdAt.localeCompare(b.createdAt);
    });
  }

  // ── Mutations ──────────────────────────────────────────────────────────────

  createTicket(fields: {
    title: string;
    description: string;
    priority?: Priority;
    creator: string;
    assignee?: string;
    tags?: string[];
    threadId?: string;
  }): Promise<Ticket> {
    return this.serialise(async () => {
      const existing = this.findByTitle(fields.title);
      if (existing) return existing;
      // Derive next seq from actual tickets in case nextSeq drifted
      const maxExisting = Object.keys(this.board.tickets)
        .map(k => parseInt(k.replace('TKT-', ''), 10))
        .filter(n => !isNaN(n))
        .reduce((m, n) => Math.max(m, n), 0);
      const seq = Math.max(this.board.nextSeq, maxExisting + 1);
      this.board.nextSeq = seq + 1;

      const id = `TKT-${String(seq).padStart(3, '0')}`;
      const ticket: Ticket = {
        id,
        title: fields.title,
        description: fields.description,
        priority: fields.priority ?? 'medium',
        column: 'backlog',
        creator: fields.creator,
        assignee: fields.assignee,
        tags: fields.tags ?? [],
        comments: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...(fields.threadId ? { threadId: fields.threadId } : {}),
      };
      this.board.tickets[id] = ticket;
      await this.save();
      return ticket;
    });
  }

  moveTicket(id: string, column: Column, closedReason?: ClosedReason): Promise<Ticket> {
    return this.serialise(async () => {
      const ticket = this.requireTicket(id);
      ticket.column = column;
      if (column === 'closed') {
        ticket.closedReason = closedReason ?? 'completed';
      } else {
        delete ticket.closedReason;
      }
      ticket.updatedAt = new Date().toISOString();
      await this.save();
      return ticket;
    });
  }

  assignTicket(id: string, assignee: string): Promise<Ticket> {
    return this.serialise(async () => {
      const ticket = this.requireTicket(id);
      ticket.assignee = assignee;
      ticket.updatedAt = new Date().toISOString();
      await this.save();
      return ticket;
    });
  }

  updateTicket(id: string, fields: Partial<Pick<Ticket, 'title' | 'description' | 'priority' | 'tags'>>): Promise<Ticket> {
    return this.serialise(async () => {
      const ticket = this.requireTicket(id);
      Object.assign(ticket, fields);
      ticket.updatedAt = new Date().toISOString();
      await this.save();
      return ticket;
    });
  }

  addComment(id: string, author: string, text: string): Promise<Ticket> {
    return this.serialise(async () => {
      const ticket = this.requireTicket(id);
      const comment: Comment = {
        id: uuidv4(),
        author,
        text,
        ts: new Date().toISOString(),
      };
      ticket.comments.push(comment);
      ticket.updatedAt = new Date().toISOString();
      await this.save();
      return ticket;
    });
  }

  addBlocker(id: string, blockerId: string): Promise<Ticket> {
    return this.serialise(async () => {
      const ticket = this.requireTicket(id);
      this.requireTicket(blockerId); // ensure blocker exists
      ticket.blockedBy = [...new Set([...(ticket.blockedBy ?? []), blockerId])];
      if (ticket.column !== 'blocked') {
        ticket.column = 'blocked';
      }
      ticket.updatedAt = new Date().toISOString();
      await this.save();
      return ticket;
    });
  }

  removeBlocker(id: string, blockerId: string): Promise<Ticket> {
    return this.serialise(async () => {
      const ticket = this.requireTicket(id);
      ticket.blockedBy = (ticket.blockedBy ?? []).filter(b => b !== blockerId);
      ticket.updatedAt = new Date().toISOString();
      await this.save();
      return ticket;
    });
  }

  /**
   * When a ticket completes, remove it from the blockedBy list of any dependents.
   * Returns tickets that were unblocked (blockedBy became empty and were moved to ready).
   */
  unblockDependents(completedId: string): Promise<Ticket[]> {
    return this.serialise(async () => {
      const unblocked: Ticket[] = [];
      for (const ticket of Object.values(this.board.tickets)) {
        if (!(ticket.blockedBy ?? []).includes(completedId)) continue;
        ticket.blockedBy = ticket.blockedBy!.filter(b => b !== completedId);
        ticket.updatedAt = new Date().toISOString();
        if (ticket.blockedBy.length === 0 && ticket.column === 'blocked') {
          ticket.column = 'ready';
          unblocked.push(ticket);
        }
      }
      if (unblocked.length > 0) await this.save();
      return unblocked;
    });
  }

  deleteTicket(id: string): Promise<void> {
    return this.serialise(async () => {
      this.requireTicket(id);
      delete this.board.tickets[id];
      await this.save();
    });
  }

  // ── Persistence ────────────────────────────────────────────────────────────
  //
  // The board lives in the project's database rather than its own JSON file.
  // Every ticket mutation used to go through save(), which was a plain
  // writeFile — it truncates first, so a crash mid-move left a partial board
  // and load() throws on one rather than silently starting empty. Nine of the
  // eleven mutations took that path. A transaction gives all of them the
  // atomicity only two of them had.
  //
  // reload() is gone with it. It re-read the file before every query because
  // another process could have written it; nothing else writes this board.

  private requireTicket(id: string): Ticket {
    const ticket = this.board.tickets[id];
    if (!ticket) throw new Error(`Ticket "${id}" not found`);
    return ticket;
  }

  private database(): DatabaseSync {
    if (!this.db) throw new Error('KanbanStore.load() has not been called.');
    return this.db;
  }

  /** Kept as the name nine mutations call. One write path now, and it is atomic. */
  private save(): Promise<void> {
    return this.persist();
  }

  /**
   * Write the board.
   *
   * The whole board each time, in one transaction. A board is tens of
   * tickets, not thousands, so the cost is one fsync either way and the
   * alternative — tracking which rows each mutation touched — is bookkeeping
   * for no measurable gain. If boards ever grow, this is the place to make
   * it targeted.
   */
  private async persist(): Promise<void> {
    const db = this.database();
    const tickets = Object.values(this.board.tickets);

    inTransaction(db, () => {
      db.prepare('INSERT OR REPLACE INTO board_meta (key, value) VALUES (?, ?)')
        .run('nextSeq', String(this.board.nextSeq));

      const keep = new Set(tickets.map((t) => t.id));
      for (const row of db.prepare('SELECT id FROM tickets').all() as unknown as Array<{ id: string }>) {
        if (!keep.has(row.id)) db.prepare('DELETE FROM tickets WHERE id = ?').run(row.id);
      }

      const upsert = db.prepare(
        `INSERT OR REPLACE INTO tickets
           (id, title, description, priority, col, creator, assignee, tags,
            createdAt, updatedAt, closedReason, projectName, projectFolder,
            lastTaskId, threadId)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const addComment = db.prepare(
        'INSERT INTO ticket_comments (id, ticketId, author, text, ts) VALUES (?, ?, ?, ?, ?)',
      );
      const addBlocker = db.prepare(
        'INSERT INTO ticket_blockers (ticketId, blockerId) VALUES (?, ?)',
      );

      for (const t of tickets) {
        // Defaulted rather than trusted. The Ticket type says these are
        // always present; real boards disagree. paige's TKT-003 has no
        // title, description or priority — which JSON stored happily and a
        // NOT NULL column will not. Refusing the write would lose the whole
        // board over one malformed ticket from months ago.
        const now = new Date().toISOString();
        upsert.run(
          t.id,
          t.title ?? '(untitled)',
          t.description ?? '',
          t.priority ?? 'medium',
          t.column ?? 'backlog',
          t.creator ?? 'unknown',
          t.assignee ?? null, JSON.stringify(t.tags ?? []),
          t.createdAt ?? now, t.updatedAt ?? now, t.closedReason ?? null,
          t.projectName ?? null, t.projectFolder ?? null,
          t.lastTaskId ?? null, t.threadId ?? null);

        // Replaced wholesale rather than diffed: a ticket has a handful of
        // comments and working out which are new costs more than rewriting.
        //
        // Defaulted for the same reason the ticket fields are — real boards
        // contain comments with no author, which JSON stored without
        // complaint.
        db.prepare('DELETE FROM ticket_comments WHERE ticketId = ?').run(t.id);
        for (const c of t.comments ?? []) {
          addComment.run(c.id ?? uuidv4(), t.id, c.author ?? 'unknown',
            c.text ?? '', c.ts ?? now);
        }

        db.prepare('DELETE FROM ticket_blockers WHERE ticketId = ?').run(t.id);
        for (const b of t.blockedBy ?? []) {
          if (typeof b === 'string' && b) addBlocker.run(t.id, b);
        }
      }
    });
  }

  /** Read every row back into the in-memory board. */
  private readBoard(): Board {
    const db = this.database();

    const meta = db.prepare("SELECT value FROM board_meta WHERE key = 'nextSeq'")
      .get() as { value: string } | undefined;

    const comments = new Map<string, Comment[]>();
    for (const c of db.prepare(
      'SELECT id, ticketId, author, text, ts FROM ticket_comments ORDER BY ts, rowid',
    ).all() as unknown as Array<Comment & { ticketId: string }>) {
      const list = comments.get(c.ticketId) ?? [];
      list.push({ id: c.id, author: c.author, text: c.text, ts: c.ts });
      comments.set(c.ticketId, list);
    }

    const blockers = new Map<string, string[]>();
    for (const b of db.prepare('SELECT ticketId, blockerId FROM ticket_blockers').all() as unknown as Array<{ ticketId: string; blockerId: string }>) {
      blockers.set(b.ticketId, [...(blockers.get(b.ticketId) ?? []), b.blockerId]);
    }

    const tickets: Record<string, Ticket> = {};
    for (const row of db.prepare(
      `SELECT id, title, description, priority, col, creator, assignee, tags,
              createdAt, updatedAt, closedReason, projectName, projectFolder,
              lastTaskId, threadId
       FROM tickets`,
    ).all() as unknown as TicketRow[]) {
      tickets[row.id] = {
        id: row.id,
        title: row.title,
        description: row.description,
        priority: row.priority as Priority,
        column: row.col as Column,
        creator: row.creator,
        ...(row.assignee ? { assignee: row.assignee } : {}),
        tags: JSON.parse(row.tags || '[]') as string[],
        comments: comments.get(row.id) ?? [],
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        // Always an array, never absent. Rows cannot tell "no blockers" from
        // "the key was never there", and several call sites do
        // `ticket.blockedBy!.filter(...)` — which throws on undefined but is
        // fine on an empty array. The invariant is worth more than matching
        // whichever of the two a given ticket happened to have.
        blockedBy: blockers.get(row.id) ?? [],
        ...(row.closedReason ? { closedReason: row.closedReason as ClosedReason } : {}),
        ...(row.projectName ? { projectName: row.projectName } : {}),
        ...(row.projectFolder ? { projectFolder: row.projectFolder } : {}),
        ...(row.lastTaskId ? { lastTaskId: row.lastTaskId } : {}),
        ...(row.threadId ? { threadId: row.threadId } : {}),
      };
    }

    return { tickets, nextSeq: Number(meta?.value ?? 1) };
  }

  /**
   * The whole board.
   *
   * For the HTTP routes, which edit in bulk rather than a ticket at a time.
   * Everything still goes through this object, which is the point — there
   * used to be three places that opened the file.
   */
  async getBoard(): Promise<Board> {
    return this.board;
  }

  /** Replace the board wholesale, for the same callers. */
  async replaceBoard(board: Board): Promise<void> {
    this.board = board;
    await this.persist();
  }
}

interface TicketRow {
  id: string; title: string; description: string; priority: string; col: string;
  creator: string; assignee: string | null; tags: string;
  createdAt: string; updatedAt: string; closedReason: string | null;
  projectName: string | null; projectFolder: string | null;
  lastTaskId: string | null; threadId: string | null;
}
