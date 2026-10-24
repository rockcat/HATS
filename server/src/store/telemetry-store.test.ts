// What every model call cost, now aggregated by the database.
//
// The important property is that getSummary() agrees exactly with walking
// the records by hand — the old implementation did the latter, and the whole
// point of the change is that nobody should notice the difference except in
// how long it takes and how much memory it holds.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { TelemetryStore, type TelemetryRecord } from './telemetry-store.js';
import { closeAllProjectDbs } from './project-db.js';

let dir: string;
let logPath: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'hats-telemetry-'));
  logPath = path.join(dir, 'telemetry.jsonl');
});

afterEach(async () => {
  closeAllProjectDbs();
  await rm(dir, { recursive: true, force: true });
});

const freshStore = async () => {
  const store = new TelemetryStore(logPath);
  await store.init();
  return store;
};

const call = (over: Partial<TelemetryRecord> = {}) => ({
  ts: new Date().toISOString(),
  agent: 'Poppy',
  provider: 'anthropic',
  model: 'claude-opus-5',
  promptLength: 1000,
  inputTokens: 100,
  outputTokens: 50,
  cost: 0.25,
  ...over,
});

describe('recording', () => {
  it('gives every record an id', async () => {
    const store = await freshStore();
    const rec = await store.record(call());
    expect(rec.id).toBe('tel-1');
  });

  it('keeps the numbers it was given', async () => {
    const store = await freshStore();
    await store.record(call({ inputTokens: 1234, outputTokens: 567, cost: 1.5 }));

    const [rec] = store.getAll();
    expect(rec!.inputTokens).toBe(1234);
    expect(rec!.outputTokens).toBe(567);
    expect(rec!.cost).toBeCloseTo(1.5);
  });

  it('survives a restart', async () => {
    const store = await freshStore();
    await store.record(call());
    await store.record(call());
    closeAllProjectDbs();

    const second = await freshStore();
    expect(second.getAll()).toHaveLength(2);
  });

  it('does not reuse an id after a restart', async () => {
    // The sequence used to be the record count, which collides the moment
    // anything is ever removed.
    const store = await freshStore();
    await store.record(call());
    await store.record(call());
    closeAllProjectDbs();

    const second = await freshStore();
    const next = await second.record(call());
    expect(next.id).toBe('tel-3');
    expect(second.getAll()).toHaveLength(3);
  });
});

describe('summarising', () => {
  it('totals calls, tokens and cost', async () => {
    const store = await freshStore();
    await store.record(call({ inputTokens: 100, outputTokens: 10, cost: 1 }));
    await store.record(call({ inputTokens: 200, outputTokens: 20, cost: 2 }));

    const s = store.getSummary();
    expect(s.totalCalls).toBe(2);
    expect(s.totalInputTokens).toBe(300);
    expect(s.totalOutputTokens).toBe(30);
    expect(s.totalCost).toBeCloseTo(3);
  });

  it('groups by agent and by model', async () => {
    const store = await freshStore();
    await store.record(call({ agent: 'Poppy', model: 'opus',  cost: 1 }));
    await store.record(call({ agent: 'Poppy', model: 'haiku', cost: 2 }));
    await store.record(call({ agent: 'Rhoda', model: 'opus',  cost: 4 }));

    const s = store.getSummary();
    expect(s.byAgent['Poppy']!.cost).toBeCloseTo(3);
    expect(s.byAgent['Rhoda']!.cost).toBeCloseTo(4);
    expect(s.byModel['opus']!.calls).toBe(2);
    expect(s.byModel['haiku']!.calls).toBe(1);
  });

  it('agrees exactly with walking the records by hand', async () => {
    // The old implementation summarised in JavaScript. If the SQL disagrees
    // with it, somebody's cost report silently changed.
    const store = await freshStore();
    for (let n = 0; n < 50; n++) {
      await store.record(call({
        agent: n % 3 === 0 ? 'Poppy' : 'Rhoda',
        model: n % 2 === 0 ? 'opus' : 'haiku',
        inputTokens: n * 7,
        outputTokens: n * 3,
        cost: n * 0.01,
      }));
    }

    const fromSql = store.getSummary();
    const byHand  = TelemetryStore.summarize(store.getAll());

    expect(fromSql.totalCalls).toBe(byHand.totalCalls);
    expect(fromSql.totalInputTokens).toBe(byHand.totalInputTokens);
    expect(fromSql.totalOutputTokens).toBe(byHand.totalOutputTokens);
    expect(fromSql.totalCost).toBeCloseTo(byHand.totalCost, 10);
    expect(Object.keys(fromSql.byAgent).sort()).toEqual(Object.keys(byHand.byAgent).sort());
    for (const agent of Object.keys(byHand.byAgent)) {
      expect(fromSql.byAgent[agent]!.calls).toBe(byHand.byAgent[agent]!.calls);
      expect(fromSql.byAgent[agent]!.cost).toBeCloseTo(byHand.byAgent[agent]!.cost, 10);
    }
  });

  it('answers sensibly with nothing recorded', async () => {
    const store = await freshStore();
    const s = store.getSummary();
    expect(s).toMatchObject({ totalCalls: 0, totalCost: 0, byAgent: {}, byModel: {} });
  });
});

describe('importing an existing log', () => {
  const lines = (...recs: object[]) => recs.map((r) => JSON.stringify(r)).join('\n') + '\n';

  it('brings a JSONL log in on first open', async () => {
    await writeFile(logPath, lines(
      { id: 'tel-1', ts: '2026-01-01T00:00:00.000Z', agent: 'Poppy', provider: 'anthropic', model: 'opus', promptLength: 10, inputTokens: 5, outputTokens: 2, cost: 0.5 },
      { id: 'tel-2', ts: '2026-01-02T00:00:00.000Z', agent: 'Rhoda', provider: 'openai', model: 'gpt', promptLength: 20, inputTokens: 7, outputTokens: 3, cost: 1.5 },
    ));

    const store = await freshStore();
    expect(store.getAll()).toHaveLength(2);
    expect(store.getSummary().totalCost).toBeCloseTo(2);
  });

  it('continues the sequence rather than colliding with imported ids', async () => {
    await writeFile(logPath, lines(
      { id: 'tel-1', ts: '2026-01-01T00:00:00.000Z', agent: 'Poppy', provider: 'p', model: 'm', promptLength: 1, inputTokens: 1, outputTokens: 1, cost: 0 },
      { id: 'tel-9', ts: '2026-01-02T00:00:00.000Z', agent: 'Poppy', provider: 'p', model: 'm', promptLength: 1, inputTokens: 1, outputTokens: 1, cost: 0 },
    ));

    const store = await freshStore();
    const next = await store.record(call());
    expect(next.id).toBe('tel-10');
    expect(store.getAll()).toHaveLength(3);
  });

  it('leaves the original file alone', async () => {
    await writeFile(logPath, lines(
      { id: 'tel-1', ts: '2026-01-01T00:00:00.000Z', agent: 'P', provider: 'p', model: 'm', promptLength: 1, inputTokens: 1, outputTokens: 1, cost: 0 },
    ));
    await freshStore();
    expect(existsSync(logPath)).toBe(true);
  });

  it('skips a truncated final line', async () => {
    await writeFile(logPath, lines(
      { id: 'tel-1', ts: '2026-01-01T00:00:00.000Z', agent: 'P', provider: 'p', model: 'm', promptLength: 1, inputTokens: 1, outputTokens: 1, cost: 0 },
    ) + '{"id":"tel-2","ts":"2026');

    const store = await freshStore();
    expect(store.getAll()).toHaveLength(1);
  });
});
