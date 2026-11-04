import { describe, it, expect, vi } from 'vitest';
import { KanbanManager } from './kanban-manager.js';
import type { Board, Ticket } from '../mcp/kanban/types.js';
import type { KanbanStore } from '../mcp/kanban/store.js';
import type { TeamOrchestrator } from '../orchestrator/orchestrator.js';

const HOUR = 60 * 60 * 1000;

const ticket = (id: string, over: Partial<Ticket> = {}): Ticket => ({
  id, title: id, description: '', priority: 'medium', column: 'in_progress',
  creator: 'human', assignee: 'Rhoda', tags: [], comments: [],
  createdAt: new Date(Date.now() - 2 * HOUR).toISOString(),
  updatedAt: new Date(Date.now() - 2 * HOUR).toISOString(),
  ...over,
});

function managerFor(tickets: Ticket[]) {
  const board: Board = { tickets: Object.fromEntries(tickets.map(t => [t.id, t])), nextSeq: 1 };
  const humanMessage = vi.fn(() => Promise.resolve());
  const orchestrator = { listAgents: () => [{ name: 'Rhoda' }], humanMessage } as unknown as TeamOrchestrator;
  const manager = new KanbanManager('kanban-board.json', {
    getOrchestrator:  () => orchestrator,
    agentTicketMap:   new Map(),
    agentActivity:    new Map(),
    resolveAgentName: (n) => n,
    agentIdForName:   (n) => n,
    sseBroadcast:     () => {},
    getKanbanStore:   () => ({ getBoard: async () => board }) as unknown as KanbanStore,
    json:             () => {},
    readBody:         async () => '',
  });
  return { manager, humanMessage };
}

describe('nudgeStaleTickets', () => {
  it('chases a stale ticket', async () => {
    const { manager, humanMessage } = managerFor([ticket('TKT-001')]);
    await manager.nudgeStaleTickets();
    expect(humanMessage).toHaveBeenCalledOnce();
  });

  it('leaves a long-running ticket alone', async () => {
    const { manager, humanMessage } = managerFor([
      ticket('TKT-001', { longRunning: true }),
      ticket('TKT-002', { longRunning: true, column: 'blocked', blockedBy: ['TKT-009'] }),
    ]);
    await manager.nudgeStaleTickets();
    expect(humanMessage).not.toHaveBeenCalled();
  });
});
