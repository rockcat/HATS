import type { Column, Ticket } from './types.js';

/**
 * Would this move take a long-running ticket out of progress?
 *
 * Such a ticket stays in progress until someone explicitly says otherwise.
 * Finishing one piece of it, or hitting a question along the way, is not the
 * end of the work.
 */
export function leavesLongRunningInProgress(ticket: Pick<Ticket, 'column' | 'longRunning'>, to: Column | string): boolean {
  return !!ticket.longRunning && ticket.column === 'in_progress' && to !== 'in_progress';
}
