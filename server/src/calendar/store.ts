// ── One agent's diary ─────────────────────────────────────────────────────────
//
// A single .ics file per agent, in its own directory beside its memory. A real
// iCalendar file rather than a convenient JSON one, so it can be opened in any
// calendar application, backed up, diffed, and read by a human who wants to
// know what an agent thinks it is doing on Thursday.
//
// Written whole on every change. These are diaries, not ledgers — tens of
// events, not thousands — and rewriting the file is what makes it safe to
// hand-edit between runs.

import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { buildCalendar, parseCalendar } from './icalendar.js';
import type { CalendarEvent, Participation } from './types.js';

/** Does this event overlap the window? Touching at an edge does not count. */
export function overlaps(event: CalendarEvent, from: Date, to: Date): boolean {
  return event.start < to && event.end > from;
}

/** Events that would block a new booking: anything not cancelled or declined. */
export function isBusy(event: CalendarEvent, self?: string): boolean {
  if (event.status === 'CANCELLED') return false;
  if (!self) return true;
  const mine = event.attendees?.find((a) => a.email.toLowerCase() === self.toLowerCase());
  return mine?.status !== 'DECLINED';
}

/**
 * The first gap of `minutes` between `from` and `to`, or null if there is none.
 *
 * Walks the busy periods in order rather than probing slot by slot, so the
 * answer does not depend on where a slot grid happens to fall.
 */
export function firstFreeSlot(
  events: CalendarEvent[], from: Date, to: Date, minutes: number, self?: string,
): { start: Date; end: Date } | null {
  const needed = minutes * 60_000;
  const busy = events
    .filter((e) => isBusy(e, self) && overlaps(e, from, to))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  let at = from.getTime();
  for (const event of busy) {
    if (event.start.getTime() - at >= needed) break;
    at = Math.max(at, event.end.getTime());
  }
  return at + needed <= to.getTime() ? { start: new Date(at), end: new Date(at + needed) } : null;
}

export class CalendarStore {
  private events: CalendarEvent[] = [];
  private loaded = false;

  constructor(private readonly file: string) {}

  /** Where this calendar lives, for telling a human. */
  get path(): string { return this.file; }

  async load(): Promise<void> {
    try {
      this.events = parseCalendar(await readFile(this.file, 'utf8')).events;
    } catch (err) {
      // No file yet is the normal first run, not a problem to report.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      this.events = [];
    }
    this.loaded = true;
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.load();
  }

  /**
   * Write the whole calendar.
   *
   * Temp file then rename, so a crash midway leaves the previous diary intact
   * rather than half a file that parses to nothing.
   */
  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    await writeFile(temp, buildCalendar(this.events), 'utf8');
    await rename(temp, this.file);
  }

  async all(): Promise<CalendarEvent[]> {
    await this.ensureLoaded();
    return [...this.events].sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  async between(from: Date, to: Date): Promise<CalendarEvent[]> {
    return (await this.all()).filter((e) => overlaps(e, from, to));
  }

  async find(uid: string): Promise<CalendarEvent | undefined> {
    await this.ensureLoaded();
    return this.events.find((e) => e.uid === uid);
  }

  /** Add an event, or replace one with the same UID. */
  async put(event: CalendarEvent): Promise<CalendarEvent> {
    await this.ensureLoaded();
    const at = this.events.findIndex((e) => e.uid === event.uid);
    const stored = { ...event, stamp: event.stamp ?? new Date() };
    if (at >= 0) this.events[at] = stored; else this.events.push(stored);
    await this.persist();
    return stored;
  }

  /**
   * Change an event, bumping SEQUENCE.
   *
   * Invitees' calendars ignore an update whose sequence has not moved, so
   * forgetting this makes a rescheduled meeting silently stay put for
   * everyone else.
   */
  async update(uid: string, changes: Partial<CalendarEvent>): Promise<CalendarEvent | null> {
    const existing = await this.find(uid);
    if (!existing) return null;
    return this.put({
      ...existing,
      ...changes,
      uid: existing.uid,
      sequence: (existing.sequence ?? 0) + 1,
      stamp: new Date(),
    });
  }

  /**
   * Mark an event cancelled rather than deleting it.
   *
   * A deleted event cannot be cancelled to the people who have it in their
   * diary, and they would be left holding a meeting nobody is coming to.
   */
  async cancel(uid: string): Promise<CalendarEvent | null> {
    return this.update(uid, { status: 'CANCELLED' });
  }

  /** Remove an event outright. For declining someone else's invitation. */
  async remove(uid: string): Promise<boolean> {
    await this.ensureLoaded();
    const before = this.events.length;
    this.events = this.events.filter((e) => e.uid !== uid);
    if (this.events.length === before) return false;
    await this.persist();
    return true;
  }

  /** Record one attendee's answer, as a REPLY arrives. */
  async recordResponse(uid: string, email: string, status: Participation): Promise<CalendarEvent | null> {
    const event = await this.find(uid);
    if (!event) return null;

    const attendees = [...(event.attendees ?? [])];
    const at = attendees.findIndex((a) => a.email.toLowerCase() === email.toLowerCase());
    if (at >= 0) attendees[at] = { ...attendees[at]!, status };
    else attendees.push({ email, status });

    // Not an update() — a reply is not a change to the meeting, and bumping
    // the sequence here would tell everyone else to refresh for nothing.
    return this.put({ ...event, attendees });
  }

  async freeSlot(from: Date, to: Date, minutes: number, self?: string) {
    return firstFreeSlot(await this.all(), from, to, minutes, self);
  }
}

/** A UID that is unique and says where it came from, as the spec advises. */
export function newUid(): string {
  return `${randomUUID()}@hats`;
}
