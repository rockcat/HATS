import { describe, it, expect } from 'vitest';
import { AgendaStore } from '../api/agenda-store.js';
import { AgendaRunner } from './agenda-runner.js';

describe('recording when an entry ran', () => {
  it('stamps a repeating entry and schedules its next run', async () => {
    const store = new AgendaStore(null);
    const e = await store.add({ agentName: 'Rhoda', label: 'Check Kanban', description: 'look', intervalSeconds: 600 });
    const runner = new AgendaRunner(store, async () => {});

    const before = Date.now();
    await runner.tick(true);

    const after = store.get(e.id)!;
    expect(after.lastRunAt).toBeGreaterThanOrEqual(before);
    expect(after.nextRunAt).toBe(after.lastRunAt! + 600_000);
  });

  it('stamps a one-off entry as it switches it off', async () => {
    const store = new AgendaStore(null);
    const e = await store.add({ agentName: 'Rhoda', label: 'Once', description: 'now', intervalSeconds: null });
    await new AgendaRunner(store, async () => {}).tick(true);

    expect(store.get(e.id)).toMatchObject({ enabled: false });
    expect(store.get(e.id)!.lastRunAt).toBeTypeOf('number');
  });

  it('leaves it unstamped when firing fails', async () => {
    const store = new AgendaStore(null);
    const e = await store.add({ agentName: 'Rhoda', label: 'x', description: 'y', intervalSeconds: 600 });
    await new AgendaRunner(store, async () => { throw new Error('no agent'); }).tick(true);

    expect(store.get(e.id)!.lastRunAt).toBeUndefined();
  });
});
