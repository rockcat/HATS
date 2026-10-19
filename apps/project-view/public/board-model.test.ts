import { describe, it, expect } from 'vitest';
// @ts-expect-error — a browser module with no imports, so it loads here.
import { COLUMNS, byAssignee, stale, summarise, toColumns } from './board-model.js';

const ticket = (over: Record<string, unknown> = {}) => ({
  id: 'TKT-001', title: 'Something', column: 'backlog',
  priority: 'medium', createdAt: '2026-10-01T09:00:00Z', ...over,
});

const boardOf = (tickets: Array<Record<string, unknown>>) =>
  ({ tickets: Object.fromEntries(tickets.map((t) => [t['id'], t])) });

describe('grouping a board into columns', () => {
  it('returns every column, in the order work moves', () => {
    expect(toColumns(boardOf([])).map((c: { column: string }) => c.column)).toEqual(COLUMNS);
  });

  it('keeps an empty column rather than hiding it', () => {
    // A board with nothing in review should still show that review exists.
    const columns = toColumns(boardOf([ticket()]));
    expect(columns.find((c: { column: string }) => c.column === 'review')?.tickets).toEqual([]);
  });

  it('puts each ticket in its own column', () => {
    const columns = toColumns(boardOf([
      ticket({ id: 'A', column: 'in_progress' }),
      ticket({ id: 'B', column: 'blocked' }),
    ]));

    expect(columns.find((c: { column: string }) => c.column === 'in_progress')?.tickets)
      .toHaveLength(1);
    expect(columns.find((c: { column: string }) => c.column === 'blocked')?.tickets)
      .toHaveLength(1);
  });

  it('treats a ticket with no column as backlog', () => {
    const columns = toColumns(boardOf([ticket({ column: undefined })]));
    expect(columns[0]?.tickets).toHaveLength(1);
  });

  it('reads an array as readily as a map', () => {
    // The board endpoint has returned both shapes; falling over on one is no use.
    expect(toColumns([ticket()])[0]?.tickets).toHaveLength(1);
    expect(toColumns({ tickets: [ticket()] })[0]?.tickets).toHaveLength(1);
  });

  it('ignores rubbish rather than rendering it', () => {
    const columns = toColumns({ tickets: { a: null, b: 'nonsense', c: ticket() } });
    expect(columns[0]?.tickets).toHaveLength(1);
  });

  it('copes with nothing at all', () => {
    expect(toColumns(undefined)).toHaveLength(COLUMNS.length);
    expect(toColumns(null)[0]?.tickets).toEqual([]);
  });
});

describe('the order within a column', () => {
  it('leads with the most urgent', () => {
    const columns = toColumns(boardOf([
      ticket({ id: 'LOW', priority: 'low' }),
      ticket({ id: 'CRIT', priority: 'critical' }),
      ticket({ id: 'MED', priority: 'medium' }),
    ]));

    expect(columns[0]?.tickets.map((t: { id: string }) => t.id)).toEqual(['CRIT', 'MED', 'LOW']);
  });

  it('puts the oldest first within one priority', () => {
    // A critical ticket sitting untouched for a week is the one worth seeing;
    // sorting by recency buries it under this morning's.
    const columns = toColumns(boardOf([
      ticket({ id: 'NEW', priority: 'high', createdAt: '2026-10-18T09:00:00Z' }),
      ticket({ id: 'OLD', priority: 'high', createdAt: '2026-10-02T09:00:00Z' }),
    ]));

    expect(columns[0]?.tickets.map((t: { id: string }) => t.id)).toEqual(['OLD', 'NEW']);
  });

  it('treats a ticket with no priority as medium', () => {
    const columns = toColumns(boardOf([
      ticket({ id: 'NONE', priority: undefined }),
      ticket({ id: 'LOW', priority: 'low' }),
      ticket({ id: 'HIGH', priority: 'high' }),
    ]));

    expect(columns[0]?.tickets.map((t: { id: string }) => t.id)).toEqual(['HIGH', 'NONE', 'LOW']);
  });
});

describe('summarising a board', () => {
  const board = boardOf([
    ticket({ id: 'A', column: 'backlog' }),
    ticket({ id: 'B', column: 'in_progress' }),
    ticket({ id: 'C', column: 'blocked' }),
    ticket({ id: 'D', column: 'closed' }),
  ]);

  it('counts what is still open, excluding closed', () => {
    expect(summarise(board).open).toBe(3);
  });

  it('counts blocked separately, because it is the number that should prompt action', () => {
    expect(summarise(board).blocked).toBe(1);
  });

  it('counts what is being worked on', () => {
    expect(summarise(board).inProgress).toBe(1);
  });

  it('says nothing is happening on an empty board', () => {
    expect(summarise(boardOf([]))).toEqual({ open: 0, blocked: 0, inProgress: 0, closed: 0 });
  });
});

describe('who is carrying what', () => {
  it('groups live work by assignee', () => {
    const board = boardOf([
      ticket({ id: 'A', column: 'in_progress', assignee: 'Poppy' }),
      ticket({ id: 'B', column: 'review', assignee: 'Poppy' }),
      ticket({ id: 'C', column: 'in_progress', assignee: 'Rhoda' }),
    ]);

    const held = byAssignee(board);
    expect(held[0]).toMatchObject({ who: 'Poppy' });
    expect(held[0]?.tickets).toHaveLength(2);
  });

  it('puts the busiest first, which is the point of looking', () => {
    const board = boardOf([
      ticket({ id: 'A', column: 'in_progress', assignee: 'Rhoda' }),
      ticket({ id: 'B', column: 'in_progress', assignee: 'Poppy' }),
      ticket({ id: 'C', column: 'in_progress', assignee: 'Poppy' }),
    ]);

    expect(byAssignee(board)[0]?.who).toBe('Poppy');
  });

  it('does not count backlog against anybody', () => {
    // Being assigned something nobody has started is not being busy.
    const board = boardOf([ticket({ column: 'backlog', assignee: 'Poppy' })]);
    expect(byAssignee(board)).toEqual([]);
  });

  it('names unassigned work rather than dropping it', () => {
    const board = boardOf([ticket({ column: 'in_progress', assignee: undefined })]);
    expect(byAssignee(board)[0]?.who).toBe('unassigned');
  });
});

describe('finding what has stopped moving', () => {
  const now = Date.parse('2026-10-19T09:00:00Z');
  const daysAgo = (n: number) => new Date(now - n * 86_400_000).toISOString();

  it('flags work untouched for days', () => {
    const board = boardOf([ticket({ column: 'in_progress', updatedAt: daysAgo(5) })]);
    expect(stale(board, { now })).toHaveLength(1);
  });

  it('leaves recent work alone', () => {
    const board = boardOf([ticket({ column: 'in_progress', updatedAt: daysAgo(1) })]);
    expect(stale(board, { now })).toEqual([]);
  });

  it('ignores the backlog', () => {
    // A backlog item untouched for a month is a backlog item, not a problem.
    const board = boardOf([ticket({ column: 'backlog', updatedAt: daysAgo(30) })]);
    expect(stale(board, { now })).toEqual([]);
  });

  it('counts blocked work, which is exactly what goes stale', () => {
    const board = boardOf([ticket({ column: 'blocked', updatedAt: daysAgo(9) })]);
    expect(stale(board, { now })).toHaveLength(1);
  });

  it('falls back to when it was raised if it has never been touched', () => {
    const board = boardOf([
      ticket({ column: 'in_progress', createdAt: daysAgo(10), updatedAt: undefined }),
    ]);
    expect(stale(board, { now })).toHaveLength(1);
  });

  it('ignores a ticket with no usable date rather than guessing', () => {
    const board = boardOf([
      ticket({ column: 'in_progress', createdAt: undefined, updatedAt: 'not a date' }),
    ]);
    expect(stale(board, { now })).toEqual([]);
  });

  it('honours a different threshold', () => {
    const board = boardOf([ticket({ column: 'in_progress', updatedAt: daysAgo(5) })]);
    expect(stale(board, { days: 7, now })).toEqual([]);
  });
});
