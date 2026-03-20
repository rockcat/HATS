import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

export interface StoredEvent {
  id: string;
  ts: string;
  type: string;
  [key: string]: unknown;
}

/**
 * Append-only JSONL event log.
 * Every agent action, message, meeting turn, and decision is persisted here
 * in chronological order for later replay and visualisation.
 */
export class EventStore {
  private filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    // Touch file if it doesn't exist
    const handle = await fs.open(this.filePath, 'a');
    await handle.close();
  }

  /** Append one event and return it (with generated id and timestamp). */
  append(type: string, payload: Record<string, unknown>): Promise<StoredEvent> {
    const event: StoredEvent = {
      id: uuidv4(),
      ts: new Date().toISOString(),
      type,
      ...payload,
    };

    // Serialise writes — never interleave partial lines
    this.writeQueue = this.writeQueue.then(() =>
      fs.appendFile(this.filePath, JSON.stringify(event) + '\n', 'utf-8'),
    );

    return this.writeQueue.then(() => event);
  }

  /** Read all events (for replay / visualisation). */
  async readAll(): Promise<StoredEvent[]> {
    const text = await fs.readFile(this.filePath, 'utf-8').catch(() => '');
    return text
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as StoredEvent);
  }

  /** Read events since a given ISO timestamp. */
  async readSince(since: string): Promise<StoredEvent[]> {
    const all = await this.readAll();
    return all.filter((e) => e.ts > since);
  }
}
