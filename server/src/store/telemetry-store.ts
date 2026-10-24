import { readFile, mkdir } from 'fs/promises';
import * as path from 'path';
import type { DatabaseSync } from 'node:sqlite';
import {
  dbPathFor, ensureSchema, hasImported, inTransaction, markImported, openProjectDb,
} from './project-db.js';

export interface TelemetryRecord {
  id:           string;
  ts:           string;   // ISO timestamp
  agent:        string;
  provider:     string;
  model:        string;
  promptLength: number;   // system + message chars
  inputTokens:  number;
  outputTokens: number;
  cost:         number;   // USD
}

export interface TelemetrySummary {
  totalCalls:       number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost:        number;
  byModel:   Record<string, { calls: number; inputTokens: number; outputTokens: number; cost: number }>;
  byAgent:   Record<string, { calls: number; inputTokens: number; outputTokens: number; cost: number }>;
}

/**
 * What every model call cost, and who spent it.
 *
 * This used to hold every record it had ever seen in an array, parsed from a
 * JSONL file at startup and kept for the life of the process. Summarising
 * meant walking that array; the array only grew. It is a table now, and the
 * summary is four GROUP BY queries the database answers without handing back
 * a single row of detail.
 *
 * node:sqlite is synchronous, so getAll() and getSummary() stay synchronous
 * and no caller changed.
 */
export class TelemetryStore {
  private filePath: string;
  private db: DatabaseSync | null = null;
  private seq = 0;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async init(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });

    this.db = openProjectDb(dbPathFor(this.filePath));
    ensureSchema(this.db, [
      `CREATE TABLE IF NOT EXISTS telemetry (
         id           TEXT PRIMARY KEY,
         ts           TEXT NOT NULL,
         agent        TEXT NOT NULL,
         provider     TEXT NOT NULL,
         model        TEXT NOT NULL,
         promptLength INTEGER NOT NULL,
         inputTokens  INTEGER NOT NULL,
         outputTokens INTEGER NOT NULL,
         cost         REAL NOT NULL
       )`,
      'CREATE INDEX IF NOT EXISTS telemetry_ts ON telemetry (ts)',
      'CREATE INDEX IF NOT EXISTS telemetry_agent ON telemetry (agent)',
      'CREATE INDEX IF NOT EXISTS telemetry_model ON telemetry (model)',
    ]);

    if (!hasImported(this.db, 'telemetry.jsonl')) {
      await this.importLegacy();
      markImported(this.db, 'telemetry.jsonl');
    }
    this.seq = this.highestSeq();
  }

  async record(entry: Omit<TelemetryRecord, 'id'>): Promise<TelemetryRecord> {
    const rec: TelemetryRecord = { id: `tel-${++this.seq}`, ...entry };
    this.insert(rec);
    return rec;
  }

  getAll(): TelemetryRecord[] {
    return this.database()
      .prepare(`SELECT id, ts, agent, provider, model, promptLength,
                       inputTokens, outputTokens, cost
                FROM telemetry ORDER BY ts, rowid`)
      .all() as unknown as TelemetryRecord[];
  }

  /**
   * Totals, without reading the detail.
   *
   * Four aggregate queries rather than one walk over every record ever made.
   * The difference is the whole log versus a handful of rows, and it grows.
   */
  getSummary(): TelemetrySummary {
    const db = this.database();

    const totals = db.prepare(
      `SELECT COUNT(*) AS calls, COALESCE(SUM(inputTokens), 0) AS inTok,
              COALESCE(SUM(outputTokens), 0) AS outTok, COALESCE(SUM(cost), 0) AS cost
       FROM telemetry`,
    ).get() as { calls: number; inTok: number; outTok: number; cost: number };

    return {
      totalCalls:        totals.calls,
      totalInputTokens:  totals.inTok,
      totalOutputTokens: totals.outTok,
      totalCost:         totals.cost,
      byModel: this.groupedBy('model'),
      byAgent: this.groupedBy('agent'),
    };
  }

  /** The same shape, from the records themselves — for callers holding a list. */
  static summarize(records: TelemetryRecord[]): TelemetrySummary {
    const byModel:  TelemetrySummary['byModel'] = {};
    const byAgent:  TelemetrySummary['byAgent'] = {};
    let totalCalls = 0, totalIn = 0, totalOut = 0, totalCost = 0;
    for (const r of records) {
      totalCalls++;
      totalIn   += r.inputTokens;
      totalOut  += r.outputTokens;
      totalCost += r.cost;
      const m = byModel[r.model] ??= { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 };
      m.calls++; m.inputTokens += r.inputTokens; m.outputTokens += r.outputTokens; m.cost += r.cost;
      const a = byAgent[r.agent] ??= { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 };
      a.calls++; a.inputTokens += r.inputTokens; a.outputTokens += r.outputTokens; a.cost += r.cost;
    }
    return { totalCalls, totalInputTokens: totalIn, totalOutputTokens: totalOut, totalCost, byModel, byAgent };
  }

  private groupedBy(column: 'model' | 'agent'): TelemetrySummary['byModel'] {
    // The column name is one of two literals, never anything a caller chose.
    const rows = this.database().prepare(
      `SELECT ${column} AS key, COUNT(*) AS calls,
              COALESCE(SUM(inputTokens), 0) AS inTok,
              COALESCE(SUM(outputTokens), 0) AS outTok,
              COALESCE(SUM(cost), 0) AS cost
       FROM telemetry GROUP BY ${column}`,
    ).all() as unknown as Array<{ key: string; calls: number; inTok: number; outTok: number; cost: number }>;

    const out: TelemetrySummary['byModel'] = {};
    for (const row of rows) {
      out[row.key] = {
        calls: row.calls, inputTokens: row.inTok, outputTokens: row.outTok, cost: row.cost,
      };
    }
    return out;
  }

  private database(): DatabaseSync {
    if (!this.db) throw new Error('TelemetryStore.init() has not been called.');
    return this.db;
  }

  private insert(rec: TelemetryRecord): void {
    this.database().prepare(
      `INSERT OR REPLACE INTO telemetry
         (id, ts, agent, provider, model, promptLength, inputTokens, outputTokens, cost)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(rec.id, rec.ts, rec.agent, rec.provider, rec.model,
      rec.promptLength, rec.inputTokens, rec.outputTokens, rec.cost);
  }

  /**
   * The highest `tel-N` already used.
   *
   * Counting rows would be wrong: ids are not reissued when a record is
   * removed, and a count after any gap would collide with an existing id.
   */
  private highestSeq(): number {
    const row = this.database().prepare(
      `SELECT MAX(CAST(SUBSTR(id, 5) AS INTEGER)) AS n FROM telemetry WHERE id LIKE 'tel-%'`,
    ).get() as { n: number | null };
    return row.n ?? 0;
  }

  /** Bring an existing telemetry.jsonl into the table, once. */
  private async importLegacy(): Promise<void> {
    const text = await readFile(this.filePath, 'utf-8').catch(() => '');
    if (!text.trim()) return;

    const db = this.database();
    const insert = db.prepare(
      `INSERT OR IGNORE INTO telemetry
         (id, ts, agent, provider, model, promptLength, inputTokens, outputTokens, cost)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let imported = 0;
    let skipped = 0;

    inTransaction(db, () => {
      for (const [index, line] of text.split('\n').entries()) {
        if (!line.trim()) continue;
        try {
          const r = JSON.parse(line) as TelemetryRecord;
          insert.run(r.id ?? `tel-${index + 1}`, r.ts, r.agent, r.provider, r.model,
            r.promptLength ?? 0, r.inputTokens ?? 0, r.outputTokens ?? 0, r.cost ?? 0);
          imported++;
        } catch {
          skipped++;
        }
      }
    });

    // eslint-disable-next-line no-console
    console.log(`[Telemetry] Imported ${imported} record(s) from ${path.basename(this.filePath)}`
      + `${skipped ? ` (${skipped} unreadable line(s) skipped)` : ''}`);
  }
}
