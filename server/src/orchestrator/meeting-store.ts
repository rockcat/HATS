import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { ScheduledMeeting } from './types.js';

/**
 * Simple file-backed store for scheduled meetings.
 * Persists to a JSON file alongside the kanban board.
 */
export class MeetingStore {
  private meetings: Map<string, ScheduledMeeting> = new Map();
  private loaded = false;

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    if (!existsSync(this.filePath)) { this.loaded = true; return; }
    try {
      const raw = await readFile(this.filePath, 'utf-8');
      const list = JSON.parse(raw) as ScheduledMeeting[];
      for (const m of list) this.meetings.set(m.id, m);
    } catch {
      // Corrupt file — start fresh
    }
    this.loaded = true;
  }

  private async save(): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(Array.from(this.meetings.values()), null, 2), 'utf-8');
  }

  private ensureLoaded(): void {
    if (!this.loaded) throw new Error('MeetingStore not loaded — call load() first');
  }

  async add(meeting: ScheduledMeeting): Promise<void> {
    this.ensureLoaded();
    this.meetings.set(meeting.id, meeting);
    await this.save();
  }

  async update(meeting: ScheduledMeeting): Promise<void> {
    this.ensureLoaded();
    this.meetings.set(meeting.id, meeting);
    await this.save();
  }

  get(id: string): ScheduledMeeting | undefined {
    this.ensureLoaded();
    return this.meetings.get(id);
  }

  list(): ScheduledMeeting[] {
    this.ensureLoaded();
    return Array.from(this.meetings.values());
  }

  async delete(id: string): Promise<boolean> {
    this.ensureLoaded();
    const existed = this.meetings.delete(id);
    if (existed) await this.save();
    return existed;
  }

  /** Return meetings whose scheduledFor time is in the past and status is 'scheduled'. */
  getDue(): ScheduledMeeting[] {
    const now = new Date();
    return this.list().filter(
      m => m.status === 'scheduled' && new Date(m.scheduledFor) <= now,
    );
  }
}
