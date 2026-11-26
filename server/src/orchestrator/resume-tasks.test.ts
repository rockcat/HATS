// Resuming active tasks without resurrecting finished ones.
//
// A task whose ticket had been closed stayed "active" for ever, and was
// resumed on every start — seven times in an hour for a ticket closed weeks
// earlier. Each "you have an active task" exchange cost the agent two
// messages of conversation history.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { TeamOrchestrator } from './orchestrator.js';
import { closeAllProjectDbs } from '../store/project-db.js';
import type { Task } from './types.js';

let dir: string;
let orch: TeamOrchestrator;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'hats-resume-'));
  orch = new TeamOrchestrator({
    storePath: path.join(dir, 'events.jsonl'),
    projectsRoot: path.join(dir, 'projects'),
  });
  await orch.init();
  orch.setProjectDir(dir);
});

afterEach(async () => {
  closeAllProjectDbs();
  await rm(dir, { recursive: true, force: true });
});

/** Tasks are created by dispatch, which needs a live agent; this is the state it leaves. */
function addTask(over: Partial<Task>): Task {
  const task: Task = {
    id: `task-${Math.random()}`, assignedTo: 'Poppy', assignedBy: 'Paul',
    description: 'Work on ticket', status: 'active', createdAt: new Date().toISOString(),
    ...over,
  };
  (orch as unknown as { tasks: Map<string, Task> }).tasks.set(task.id, task);
  return task;
}

async function makeTicket(column?: 'closed'): Promise<string> {
  const said = await orch.callKanbanTool('create_ticket', {
    title: 'Something', description: 'to do', creator: 'Paul',
  });
  const id = /TKT-\d+/.exec(said)![0];
  if (column) await orch.callKanbanTool('move_ticket', { id, column, closed_reason: 'completed' });
  return id;
}

describe('resuming active tasks', () => {
  it('resumes a task whose ticket is still open', async () => {
    const ticketId = await makeTicket();
    const task = addTask({ ticketId });

    const { resumed, retired } = await orch.resumeActiveTasks();
    expect(resumed.map((t) => t.id)).toEqual([task.id]);
    expect(retired).toEqual([]);
  });

  it('retires a task whose ticket is closed, rather than resuming it', async () => {
    const ticketId = await makeTicket('closed');
    const task = addTask({ ticketId });

    const { resumed, retired } = await orch.resumeActiveTasks();
    expect(resumed).toEqual([]);
    expect(retired.map((t) => t.id)).toEqual([task.id]);
    expect(orch.getTask(task.id)!.status).toBe('complete');
  });

  it('does not bring a retired task back on the next start', async () => {
    const ticketId = await makeTicket('closed');
    addTask({ ticketId });

    await orch.resumeActiveTasks();
    const second = await orch.resumeActiveTasks();
    expect(second.resumed).toEqual([]);
    expect(second.retired).toEqual([]);
  });

  it('resumes a task with no ticket at all', async () => {
    // Not every task comes from the board; those have nothing to check.
    const task = addTask({});
    const { resumed } = await orch.resumeActiveTasks();
    expect(resumed.map((t) => t.id)).toEqual([task.id]);
  });

  it('leaves tasks that are not active alone', async () => {
    addTask({ status: 'complete' });
    addTask({ status: 'pending' });
    const { resumed, retired } = await orch.resumeActiveTasks();
    expect(resumed).toEqual([]);
    expect(retired).toEqual([]);
  });
});
