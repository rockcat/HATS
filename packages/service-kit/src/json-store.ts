/**
 * A keyed JSON document store backed by one file per record.
 *
 * One file per record keeps hand-editing and version control sane, and means a
 * corrupt record can never take the whole library down with it.
 */

import { mkdir, readFile, readdir, rename, rm, writeFile } from 'fs/promises';
import * as path from 'path';

export interface JsonStoreOptions<T> {
  dir: string;
  /** Extracts the record's key — also the filename stem. */
  keyOf: (record: T) => string;
  /** Called for a file that fails to parse or validate; return null to skip it. */
  onInvalid?: (file: string, reason: string) => void;
}

export class JsonStore<T> {
  private readonly dir: string;
  private readonly keyOf: (record: T) => string;
  private readonly onInvalid: ((file: string, reason: string) => void) | undefined;
  private readonly records = new Map<string, T>();
  private loaded = false;

  constructor(options: JsonStoreOptions<T>) {
    this.dir = options.dir;
    this.keyOf = options.keyOf;
    this.onInvalid = options.onInvalid;
  }

  get directory(): string { return this.dir; }

  async load(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const files = (await readdir(this.dir)).filter((f) => f.endsWith('.json'));
    this.records.clear();
    for (const file of files) {
      try {
        const raw = await readFile(path.join(this.dir, file), 'utf-8');
        const record = JSON.parse(raw) as T;
        this.records.set(this.keyOf(record), record);
      } catch (err) {
        this.onInvalid?.(file, (err as Error).message);
      }
    }
    this.loaded = true;
  }

  private assertLoaded(): void {
    if (!this.loaded) throw new Error('JsonStore used before load()');
  }

  list(): T[] {
    this.assertLoaded();
    return [...this.records.values()];
  }

  get(key: string): T | undefined {
    this.assertLoaded();
    return this.records.get(key);
  }

  has(key: string): boolean {
    this.assertLoaded();
    return this.records.has(key);
  }

  get size(): number { return this.records.size; }

  async put(record: T): Promise<T> {
    this.assertLoaded();
    const key = this.keyOf(record);
    this.records.set(key, record);
    await this.writeAtomic(key, record);
    return record;
  }

  async remove(key: string): Promise<boolean> {
    this.assertLoaded();
    if (!this.records.delete(key)) return false;
    await rm(this.filePath(key), { force: true });
    return true;
  }

  private filePath(key: string): string {
    return path.join(this.dir, `${encodeURIComponent(key)}.json`);
  }

  /** Write to a temp file then rename, so a crash mid-write cannot truncate a record. */
  private async writeAtomic(key: string, record: T): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const target = this.filePath(key);
    const temp = `${target}.tmp`;
    await writeFile(temp, JSON.stringify(record, null, 2), 'utf-8');
    await rename(temp, target);
  }
}

/** Read a single JSON file, returning a fallback when it is missing or unparseable. */
export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf-8');
}
