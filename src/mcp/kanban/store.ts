import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Board, Column, Comment, Priority, Ticket } from './types.js';

const EMPTY_BOARD: Board = { tickets: {}, nextSeq: 1 };

export class KanbanStore {
  private board: Board = { tickets: {}, nextSeq: 1 };
  private filePath: string;
  private saveQueue: Promise<void> = Promise.resolve();
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
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      this.board = JSON.parse(raw) as Board;
    } catch {
      this.board = structuredClone(EMPTY_BOARD);
      await this.persist();
    }
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  getTicket(id: string): Ticket | undefined {
    return this.board.tickets[id];
  }

  listTickets(opts: { column?: Column; assignee?: string; tag?: string } = {}): Ticket[] {
    return Object.values(this.board.tickets).filter((t) => {
      if (opts.column && t.column !== opts.column) return false;
      if (opts.assignee && t.assignee !== opts.assignee) return false;
      if (opts.tag && !t.tags.includes(opts.tag)) return false;
      return true;
    }).sort((a, b) => {
      // Sort by priority then creation date
      const pri: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      return (pri[a.priority] - pri[b.priority]) || a.createdAt.localeCompare(b.createdAt);
    });
  }

  getBoardSummary(): Record<Column, { count: number; tickets: Array<{ id: string; title: string; priority: Priority; assignee?: string }> }> {
    const columns: Column[] = ['backlog', 'ready', 'in_progress', 'blocked', 'completed'];
    const result = {} as ReturnType<typeof this.getBoardSummary>;
    for (const col of columns) {
      const tickets = this.listTickets({ column: col });
      result[col] = {
        count: tickets.length,
        tickets: tickets.map((t) => ({ id: t.id, title: t.title, priority: t.priority, assignee: t.assignee })),
      };
    }
    return result;
  }

  // ── Mutations ──────────────────────────────────────────────────────────────

  createTicket(fields: {
    title: string;
    description: string;
    priority?: Priority;
    creator: string;
    assignee?: string;
    tags?: string[];
  }): Promise<Ticket> {
    return this.serialise(async () => {
      await this.reload();
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
      };
      this.board.tickets[id] = ticket;
      this.save();
      return ticket;
    });
  }

  moveTicket(id: string, column: Column): Promise<Ticket> {
    return this.serialise(async () => {
      await this.reload();
      const ticket = this.requireTicket(id);
      ticket.column = column;
      ticket.updatedAt = new Date().toISOString();
      this.save();
      return ticket;
    });
  }

  assignTicket(id: string, assignee: string): Promise<Ticket> {
    return this.serialise(async () => {
      await this.reload();
      const ticket = this.requireTicket(id);
      ticket.assignee = assignee;
      ticket.updatedAt = new Date().toISOString();
      this.save();
      return ticket;
    });
  }

  updateTicket(id: string, fields: Partial<Pick<Ticket, 'title' | 'description' | 'priority' | 'tags'>>): Promise<Ticket> {
    return this.serialise(async () => {
      await this.reload();
      const ticket = this.requireTicket(id);
      Object.assign(ticket, fields);
      ticket.updatedAt = new Date().toISOString();
      this.save();
      return ticket;
    });
  }

  addComment(id: string, author: string, text: string): Promise<Ticket> {
    return this.serialise(async () => {
      await this.reload();
      const ticket = this.requireTicket(id);
      const comment: Comment = {
        id: uuidv4(),
        author,
        text,
        ts: new Date().toISOString(),
      };
      ticket.comments.push(comment);
      ticket.updatedAt = new Date().toISOString();
      this.save();
      return ticket;
    });
  }

  addBlocker(id: string, blockerId: string): Promise<Ticket> {
    return this.serialise(async () => {
      await this.reload();
      const ticket = this.requireTicket(id);
      this.requireTicket(blockerId); // ensure blocker exists
      ticket.blockedBy = [...new Set([...(ticket.blockedBy ?? []), blockerId])];
      if (ticket.column !== 'blocked') {
        ticket.column = 'blocked';
      }
      ticket.updatedAt = new Date().toISOString();
      this.save();
      return ticket;
    });
  }

  removeBlocker(id: string, blockerId: string): Promise<Ticket> {
    return this.serialise(async () => {
      await this.reload();
      const ticket = this.requireTicket(id);
      ticket.blockedBy = (ticket.blockedBy ?? []).filter(b => b !== blockerId);
      ticket.updatedAt = new Date().toISOString();
      this.save();
      return ticket;
    });
  }

  /**
   * When a ticket completes, remove it from the blockedBy list of any dependents.
   * Returns tickets that were unblocked (blockedBy became empty and were moved to ready).
   */
  unblockDependents(completedId: string): Promise<Ticket[]> {
    return this.serialise(async () => {
      await this.reload();
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
      if (unblocked.length > 0) this.save();
      return unblocked;
    });
  }

  deleteTicket(id: string): Promise<void> {
    return this.serialise(async () => {
      await this.reload();
      this.requireTicket(id);
      delete this.board.tickets[id];
      this.save();
    });
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  /** Re-read the board file so mutations always start from the latest on-disk state. */
  private async reload(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      this.board = JSON.parse(raw) as Board;
    } catch {
      // File missing or corrupt — keep current in-memory state
    }
  }

  private requireTicket(id: string): Ticket {
    const ticket = this.board.tickets[id];
    if (!ticket) throw new Error(`Ticket "${id}" not found`);
    return ticket;
  }

  private save(): void {
    this.saveQueue = this.saveQueue.then(() =>
      fs.writeFile(this.filePath, JSON.stringify(this.board, null, 2), 'utf-8'),
    );
  }

  private async persist(): Promise<void> {
    await fs.writeFile(this.filePath, JSON.stringify(this.board, null, 2), 'utf-8');
  }
}
