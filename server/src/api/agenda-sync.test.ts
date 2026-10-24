import { describe, it, expect } from 'vitest';
import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { AgendaStore, type AgendaEntry } from './agenda-store.js';
import { isCopyOf, planAssignment, applyAssignment, propagateEdit, removeCopies } from './agenda-sync.js';
import type { ScheduledActionDef } from '../store/team-snapshot.js';

const action = (id: string, label: string, intervalSeconds: number | null = 3600): ScheduledActionDef =>
  ({ id, label, description: `${label} please`, intervalSeconds, createdAt: '2026-01-01' });

const entry = (id: string, label: string, extra: Partial<AgendaEntry> = {}): AgendaEntry => ({
  id, agentName: 'Rhoda', label, description: '', intervalSeconds: 3600,
  nextRunAt: 0, enabled: true, createdAt: '2026-01-01', ...extra,
});

const kanban = action('a1', 'Check Kanban');
const email  = action('a2', 'Check email');

describe('recognising an action\'s copy', () => {
  it('goes by the link when there is one, even after a rename', () => {
    expect(isCopyOf(entry('e', 'Old name', { actionId: 'a1' }), kanban)).toBe(true);
    expect(isCopyOf(entry('e', 'Check Kanban', { actionId: 'zz' }), kanban)).toBe(false);
  });

  it('falls back to the label for entries written before the link existed', () => {
    expect(isCopyOf(entry('e', ' check kanban '), kanban)).toBe(true);
  });
});

describe('planning an agent\'s assignments', () => {
  it('adds an action that was just ticked', () => {
    const plan = planAssignment([], [kanban, email], ['a1']);
    expect(plan.add.map((a) => a.id)).toEqual(['a1']);
    expect(plan.remove).toEqual([]);
  });

  it('removes the copy of an action that was unticked', () => {
    const plan = planAssignment([entry('e1', 'Check Kanban', { actionId: 'a1' })], [kanban], []);
    expect(plan.remove).toEqual(['e1']);
  });

  it('removes an old unlinked copy of an unticked action, found by label', () => {
    const plan = planAssignment([entry('e1', 'Check Kanban')], [kanban], []);
    expect(plan.remove).toEqual(['e1']);
  });

  it('links an old copy that is still assigned rather than adding a second one', () => {
    const plan = planAssignment([entry('e1', 'Check Kanban')], [kanban], ['a1']);
    expect(plan.add).toEqual([]);
    expect(plan.link).toEqual([{ entryId: 'e1', actionId: 'a1' }]);
  });

  it('leaves alone what the agent scheduled for itself', () => {
    const plan = planAssignment([entry('e1', 'Weather for the trip')], [kanban], []);
    expect(plan).toEqual({ add: [], link: [], remove: [] });
  });

  it('drops a copy whose action has been deleted', () => {
    const plan = planAssignment([entry('e1', 'Gone', { actionId: 'deleted' })], [kanban], ['deleted']);
    expect(plan.remove).toEqual(['e1']);
  });
});

describe('keeping copies in step with the store', () => {
  const freshStore = async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'agenda-'));
    return new AgendaStore(path.join(dir, 'agent-agenda.json'));
  };

  it('applies a plan', async () => {
    const agenda = await freshStore();
    await applyAssignment(agenda, 'Rhoda', planAssignment([], [kanban], ['a1']));
    expect(agenda.list('Rhoda')).toMatchObject([{ label: 'Check Kanban', actionId: 'a1' }]);

    await applyAssignment(agenda, 'Rhoda', planAssignment(agenda.list('Rhoda'), [kanban], []));
    expect(agenda.list('Rhoda')).toEqual([]);
  });

  it('carries an edit into every copy but keeps each one\'s enabled state', async () => {
    const agenda = await freshStore();
    const a = await agenda.add({ agentName: 'Rhoda', label: 'Check Kanban', description: '', intervalSeconds: 3600, actionId: 'a1' });
    const b = await agenda.add({ agentName: 'Poppy', label: 'Check Kanban', description: '', intervalSeconds: 3600, actionId: 'a1' });
    await agenda.update(b.id, { enabled: false });

    const edited = { ...kanban, label: 'Review the board', intervalSeconds: 600 };
    expect(await propagateEdit(agenda, kanban, edited)).toBe(2);

    expect(agenda.get(a.id)).toMatchObject({ label: 'Review the board', intervalSeconds: 600, enabled: true });
    expect(agenda.get(b.id)).toMatchObject({ label: 'Review the board', intervalSeconds: 600, enabled: false });
  });

  it('removes every copy of a deleted action', async () => {
    const agenda = await freshStore();
    await agenda.add({ agentName: 'Rhoda', label: 'Check Kanban', description: '', intervalSeconds: 3600, actionId: 'a1' });
    await agenda.add({ agentName: 'Rhoda', label: 'Weather', description: '', intervalSeconds: 3600 });
    expect(await removeCopies(agenda, kanban)).toBe(1);
    expect(agenda.list().map((e) => e.label)).toEqual(['Weather']);
  });
});

describe('editing an entry', () => {
  it('restarts the countdown when the interval changes', async () => {
    const agenda = new AgendaStore(null);
    const e = await agenda.add({ agentName: 'Rhoda', label: 'x', description: '', intervalSeconds: 86_400 });
    const before = Date.now();
    await agenda.update(e.id, { intervalSeconds: 60 });
    expect(agenda.get(e.id)!.nextRunAt).toBeLessThanOrEqual(before + 61_000);
  });

  it('will not let a patch change who the entry belongs to', async () => {
    const agenda = new AgendaStore(null);
    const e = await agenda.add({ agentName: 'Rhoda', label: 'x', description: '', intervalSeconds: 60 });
    await agenda.update(e.id, { agentName: 'Poppy', id: 'hijack' });
    expect(agenda.get(e.id)?.agentName).toBe('Rhoda');
  });
});
