import { appendFile, readFile, writeFile, mkdir } from 'fs/promises';
import * as path from 'path';

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

export class TelemetryStore {
  private filePath: string;
  private records:  TelemetryRecord[] = [];
  private seq = 0;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async init(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await readFile(this.filePath, 'utf-8');
      this.records = raw
        .split('\n')
        .filter(l => l.trim())
        .map(l => JSON.parse(l) as TelemetryRecord);
      this.seq = this.records.length;
    } catch {
      // Fresh file
      await writeFile(this.filePath, '', 'utf-8');
    }
  }

  async record(entry: Omit<TelemetryRecord, 'id'>): Promise<TelemetryRecord> {
    const rec: TelemetryRecord = { id: `tel-${++this.seq}`, ...entry };
    this.records.push(rec);
    await appendFile(this.filePath, JSON.stringify(rec) + '\n', 'utf-8');
    return rec;
  }

  getAll(): TelemetryRecord[] {
    return [...this.records];
  }

  getSummary(): TelemetrySummary {
    const byModel:  TelemetrySummary['byModel'] = {};
    const byAgent:  TelemetrySummary['byAgent'] = {};
    let totalCalls = 0, totalIn = 0, totalOut = 0, totalCost = 0;

    for (const r of this.records) {
      totalCalls++;
      totalIn   += r.inputTokens;
      totalOut  += r.outputTokens;
      totalCost += r.cost;

      const m = byModel[r.model] ??= { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 };
      m.calls++; m.inputTokens += r.inputTokens; m.outputTokens += r.outputTokens; m.cost += r.cost;

      const a = byAgent[r.agent] ??= { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 };
      a.calls++; a.inputTokens += r.inputTokens; a.outputTokens += r.outputTokens; a.cost += r.cost;
    }

    return {
      totalCalls,
      totalInputTokens:  totalIn,
      totalOutputTokens: totalOut,
      totalCost,
      byModel,
      byAgent,
    };
  }
}
