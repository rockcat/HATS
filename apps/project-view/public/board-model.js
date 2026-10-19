// ── Shaping the board for reading ─────────────────────────────────────────────
//
// No DOM and no network. The runner serves the board as a map of tickets; what
// a person wants is columns in order, each sorted so the thing most likely to
// matter is at the top.
//
// The ordering is the only real decision here, and it is not "newest first".
// A board is read to answer "what is happening and what is stuck", so priority
// leads, and within a priority the oldest comes first — a critical ticket
// sitting untouched for a week is the one worth seeing, and sorting by recency
// buries it under whatever was raised this morning.

/** The columns, in the order work moves through them. */
export const COLUMNS = ['backlog', 'ready', 'in_progress', 'blocked', 'review', 'closed'];

export const COLUMN_LABELS = {
  backlog: 'Backlog',
  ready: 'Ready',
  in_progress: 'In progress',
  blocked: 'Blocked',
  review: 'Review',
  closed: 'Closed',
};

const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

const rank = (ticket) => PRIORITY_ORDER[ticket.priority] ?? PRIORITY_ORDER.medium;

/** Oldest first within a priority: a stale critical ticket is the point of the board. */
const oldestFirst = (a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));

/**
 * Group tickets into columns.
 *
 * Accepts either shape the runner might send — a map keyed by id, or a plain
 * array — because the board endpoint has returned both at different times and
 * a viewer that falls over on one of them is no use.
 */
export function toColumns(board) {
  const tickets = Array.isArray(board) ? board
    : Array.isArray(board?.tickets) ? board.tickets
    : Object.values(board?.tickets ?? board ?? {});

  const valid = tickets.filter((t) => t && typeof t === 'object' && t.id);
  return COLUMNS.map((column) => ({
    column,
    label: COLUMN_LABELS[column],
    tickets: valid
      .filter((t) => (t.column ?? 'backlog') === column)
      .sort((a, b) => rank(a) - rank(b) || oldestFirst(a, b)),
  }));
}

/**
 * What is worth saying about the board in one line.
 *
 * Blocked is counted separately from everything else because it is the number
 * that should make somebody do something.
 */
export function summarise(board) {
  const columns = toColumns(board);
  const count = (name) => columns.find((c) => c.column === name)?.tickets.length ?? 0;
  const open = COLUMNS.filter((c) => c !== 'closed').reduce((n, c) => n + count(c), 0);

  return {
    open,
    blocked: count('blocked'),
    inProgress: count('in_progress'),
    closed: count('closed'),
  };
}

/** Who is carrying what, for seeing an overloaded agent at a glance. */
export function byAssignee(board) {
  const working = toColumns(board)
    .filter((c) => c.column === 'in_progress' || c.column === 'review')
    .flatMap((c) => c.tickets);

  const held = new Map();
  for (const ticket of working) {
    const who = ticket.assignee ?? 'unassigned';
    held.set(who, [...(held.get(who) ?? []), ticket]);
  }
  return [...held.entries()]
    .map(([who, tickets]) => ({ who, tickets }))
    .sort((a, b) => b.tickets.length - a.tickets.length);
}

/**
 * A ticket that has not moved for a while.
 *
 * Only counts tickets somebody is supposed to be acting on: a backlog item
 * untouched for a month is a backlog item, not a problem.
 */
export function stale(board, { days = 3, now = Date.now() } = {}) {
  const cutoff = now - days * 86_400_000;
  return toColumns(board)
    .filter((c) => c.column === 'in_progress' || c.column === 'blocked')
    .flatMap((c) => c.tickets)
    .filter((t) => {
      const touched = Date.parse(t.updatedAt ?? t.createdAt ?? '');
      return Number.isFinite(touched) && touched < cutoff;
    });
}
