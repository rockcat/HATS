// "All time" must add up every project's calls, wherever each keeps them.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { TelemetryStore, mergeSummaries, type TelemetryRecord } from './telemetry-store.js';
import { allProjectsTelemetry } from './all-projects-telemetry.js';
import { closeAllProjectDbs, closeProjectDb, dbPathFor } from './project-db.js';

let root: string;

beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'hats-all-telemetry-')); });
afterEach(async () => {
  closeAllProjectDbs();
  await rm(root, { recursive: true, force: true });
});

const call = (over: Partial<TelemetryRecord> = {}): Omit<TelemetryRecord, 'id'> => ({
  ts: new Date().toISOString(), agent: 'Poppy', provider: 'anthropic', model: 'claude-opus-5',
  promptLength: 100, inputTokens: 1000, outputTokens: 100, cost: 0.5, ...over,
});

/** A project whose calls are in its database. */
async function dbProject(name: string, calls: Array<Omit<TelemetryRecord, 'id'>>, keepOpen = false) {
  const dir = path.join(root, name);
  await mkdir(dir, { recursive: true });
  const store = new TelemetryStore(path.join(dir, 'telemetry.jsonl'));
  await store.init();
  for (const c of calls) await store.record(c);
  if (!keepOpen) closeProjectDb(dbPathFor(path.join(dir, 'telemetry.jsonl')));
  return dir;
}

const since = () => new Date(Date.now() - 7 * 24 * 3600_000).toISOString();

describe('telemetry across every project', () => {
  it('counts calls kept in the database, not only the old JSONL', async () => {
    // Moved to the database with two calls in its old file, then made three more.
    const dir = path.join(root, 'moved');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'telemetry.jsonl'),
      [call({ cost: 1 }), call({ cost: 1 })].map((c, i) => JSON.stringify({ id: `tel-${i + 1}`, ...c })).join('\n'));
    await dbProject('moved', [call({ cost: 2 }), call({ cost: 2 }), call({ cost: 2 })]);

    const { summary } = await allProjectsTelemetry(root, null, since());
    expect(summary.totalCalls).toBe(5);
    expect(summary.totalCost).toBeCloseTo(8);
  });

  it('adds projects together, including one not yet moved to the database', async () => {
    await dbProject('a', [call({ agent: 'Poppy', cost: 1 })]);
    await dbProject('b', [call({ agent: 'Rex', cost: 3 })], true); // the open project
    const old = path.join(root, 'old');
    await mkdir(old);
    await writeFile(path.join(old, 'telemetry.jsonl'), JSON.stringify({ id: 'tel-1', ...call({ agent: 'Poppy', cost: 0.25 }) }));

    const { summary } = await allProjectsTelemetry(root, path.join(root, 'b'), since());
    expect(summary.totalCalls).toBe(3);
    expect(summary.totalCost).toBeCloseTo(4.25);
    expect(summary.byAgent.Poppy.cost).toBeCloseTo(1.25);
    expect(summary.byAgent.Rex.calls).toBe(1);
  });

  it('includes the open project when it is kept outside the projects folder', async () => {
    const elsewhere = await mkdtemp(path.join(tmpdir(), 'hats-open-project-'));
    try {
      const store = new TelemetryStore(path.join(elsewhere, 'telemetry.jsonl'));
      await store.init();
      await store.record(call({ cost: 7 }));
      const { summary } = await allProjectsTelemetry(root, elsewhere, since());
      expect(summary.totalCost).toBeCloseTo(7);
    } finally {
      closeAllProjectDbs();
      await rm(elsewhere, { recursive: true, force: true });
    }
  });

  it('gives the last week of calls for the chart, but totals all time', async () => {
    const old = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
    await dbProject('a', [call({ ts: old, cost: 1 }), call({ cost: 2 })]);
    const { summary, records } = await allProjectsTelemetry(root, null, since());
    expect(summary.totalCalls).toBe(2);
    expect(records.map(r => r.cost)).toEqual([2]);
  });

  it('is empty with no projects at all', async () => {
    const { summary, records } = await allProjectsTelemetry(null, null, since());
    expect(summary).toEqual(mergeSummaries([]));
    expect(records).toEqual([]);
  });
});
