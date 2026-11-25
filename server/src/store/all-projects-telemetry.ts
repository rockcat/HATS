// ── What every project has cost ──────────────────────────────────────────────
//
// Each project keeps its model calls in the telemetry table of its own
// project.db. A project not opened since that table arrived still has only
// its old telemetry.jsonl, so that is read instead. Reading only the JSONL
// files, as this once did, froze every project's total at the day it moved to
// the database — which is how "all time" came to read less than one project.

import { existsSync } from 'fs';
import { readFile, readdir } from 'fs/promises';
import * as path from 'path';
import { hasTable, withProjectDb } from './project-db.js';
import {
  TelemetryStore, mergeSummaries, recordsSince, summaryOf,
  type TelemetryRecord, type TelemetrySummary,
} from './telemetry-store.js';

export interface ProjectsTelemetry {
  summary: TelemetrySummary;
  /** Calls made since `since`, for the hourly chart; totals cover all time. */
  records: TelemetryRecord[];
}

interface OneProject { summary: TelemetrySummary; records: TelemetryRecord[] }

const NOTHING: OneProject = { summary: TelemetryStore.summarize([]), records: [] };

async function fromLegacyFile(dir: string, since: string): Promise<OneProject> {
  const text = await readFile(path.join(dir, 'telemetry.jsonl'), 'utf-8').catch(() => '');
  const all: TelemetryRecord[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { all.push(JSON.parse(line) as TelemetryRecord); } catch { /* an unreadable line */ }
  }
  return { summary: TelemetryStore.summarize(all), records: all.filter(r => r.ts >= since) };
}

async function oneProject(dir: string, since: string): Promise<OneProject> {
  const dbPath = path.join(dir, 'project.db');
  if (existsSync(dbPath)) {
    const fromDb = withProjectDb(dbPath, (db) =>
      hasTable(db, 'telemetry') ? { summary: summaryOf(db), records: recordsSince(db, since) } : null);
    if (fromDb) return fromDb;
  }
  return fromLegacyFile(dir, since);
}

/** The folders of every project: those under the root, and the open one wherever it is. */
async function projectDirs(root: string | null, openDir: string | null): Promise<string[]> {
  const dirs = new Set<string>();
  if (root) {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const e of entries) if (e.isDirectory()) dirs.add(path.resolve(root, e.name));
  }
  if (openDir) dirs.add(path.resolve(openDir));
  return [...dirs];
}

/** Every project's telemetry, totalled. */
export async function allProjectsTelemetry(
  root: string | null, openDir: string | null, since: string,
): Promise<ProjectsTelemetry> {
  const projects = await Promise.all(
    (await projectDirs(root, openDir)).map(dir => oneProject(dir, since).catch(() => NOTHING)),
  );
  return {
    summary: mergeSummaries(projects.map(p => p.summary)),
    records: projects.flatMap(p => p.records).sort((a, b) => a.ts.localeCompare(b.ts)),
  };
}
