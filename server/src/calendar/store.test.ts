import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { CalendarStore, firstFreeSlot, isBusy, newUid, overlaps } from './store.js';
import { parseCalendar } from './icalendar.js';
import type { CalendarEvent } from './types.js';

const dirs: string[] = [];
const temp = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hats-cal-'));
  dirs.push(dir);
  return dir;
};
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const at = (hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 9, 14, hour, minute, 0));

const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  uid: newUid(),
  summary: 'Standup',
  start: at(9),
  end: at(9, 30),
  ...over,
});

const storeIn = async (dir: string) => new CalendarStore(path.join(dir, 'calendar.ics'));

describe('an empty diary', () => {
  it('is empty rather than an error, on the first run', async () => {
    const store = await storeIn(await temp());
    expect(await store.all()).toEqual([]);
  });

  it('creates the directory when something is first written', async () => {
    const dir = await temp();
    const store = new CalendarStore(path.join(dir, 'nested', 'deep', 'calendar.ics'));
    await store.put(event());

    expect((await store.all())).toHaveLength(1);
  });
});

describe('keeping events', () => {
  it('writes a real iCalendar file that parses back', async () => {
    const dir = await temp();
    const store = await storeIn(dir);
    await store.put(event({ summary: 'Sprint planning' }));

    const text = await readFile(path.join(dir, 'calendar.ics'), 'utf8');
    expect(text).toContain('BEGIN:VCALENDAR');
    expect(parseCalendar(text).events[0]?.summary).toBe('Sprint planning');
  });

  it('survives a reload, which is the whole point of a file', async () => {
    const dir = await temp();
    const first = await storeIn(dir);
    await first.put(event({ summary: 'Retro' }));

    const second = await storeIn(dir);
    expect((await second.all())[0]?.summary).toBe('Retro');
  });

  it('returns them in time order, whatever order they went in', async () => {
    const store = await storeIn(await temp());
    await store.put(event({ summary: 'Afternoon', start: at(15), end: at(16) }));
    await store.put(event({ summary: 'Morning', start: at(9), end: at(10) }));

    expect((await store.all()).map((e) => e.summary)).toEqual(['Morning', 'Afternoon']);
  });

  it('replaces an event with the same uid rather than duplicating it', async () => {
    const store = await storeIn(await temp());
    const one = event({ summary: 'Draft' });
    await store.put(one);
    await store.put({ ...one, summary: 'Final' });

    const all = await store.all();
    expect(all).toHaveLength(1);
    expect(all[0]?.summary).toBe('Final');
  });

  it('reads a calendar a human edited by hand', async () => {
    // A plain .ics file is meant to be openable and editable.
    const dir = await temp();
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'calendar.ics'), [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:hand@written',
      'SUMMARY:Dentist', 'DTSTART:20261014T110000Z', 'DTEND:20261014T120000Z',
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n'), 'utf8');

    expect((await (await storeIn(dir)).all())[0]?.summary).toBe('Dentist');
  });
});

describe('changing an event', () => {
  it('bumps the sequence, or nobody else sees the change', async () => {
    // An invitee's calendar ignores an update whose sequence has not moved.
    const store = await storeIn(await temp());
    const made = await store.put(event({ sequence: 0 }));
    const moved = await store.update(made.uid, { start: at(11), end: at(12) });

    expect(moved?.sequence).toBe(1);
    expect(moved?.start.toISOString()).toBe(at(11).toISOString());
  });

  it('will not let an update change the uid', async () => {
    const store = await storeIn(await temp());
    const made = await store.put(event());
    const changed = await store.update(made.uid, { uid: 'something-else' } as Partial<CalendarEvent>);

    expect(changed?.uid).toBe(made.uid);
  });

  it('says so when there is nothing to update', async () => {
    const store = await storeIn(await temp());
    expect(await store.update('no-such-uid', { summary: 'x' })).toBeNull();
  });
});

describe('calling a meeting off', () => {
  it('marks it cancelled rather than deleting it', async () => {
    // A deleted event cannot be cancelled to the people holding it.
    const store = await storeIn(await temp());
    const made = await store.put(event());
    await store.cancel(made.uid);

    const back = await store.find(made.uid);
    expect(back?.status).toBe('CANCELLED');
  });

  it('bumps the sequence, so the cancellation is accepted', async () => {
    const store = await storeIn(await temp());
    const made = await store.put(event({ sequence: 3 }));
    expect((await store.cancel(made.uid))?.sequence).toBe(4);
  });

  it('removes outright when asked to, for declining someone else\'s', async () => {
    const store = await storeIn(await temp());
    const made = await store.put(event());

    expect(await store.remove(made.uid)).toBe(true);
    expect(await store.all()).toEqual([]);
    expect(await store.remove(made.uid)).toBe(false);
  });
});

describe('recording who answered', () => {
  it('updates an attendee that was invited', async () => {
    const store = await storeIn(await temp());
    const made = await store.put(event({
      attendees: [{ email: 'paul@example.com', status: 'NEEDS-ACTION' }],
    }));

    await store.recordResponse(made.uid, 'paul@example.com', 'ACCEPTED');
    expect((await store.find(made.uid))?.attendees?.[0]?.status).toBe('ACCEPTED');
  });

  it('matches an address whatever its case', async () => {
    const store = await storeIn(await temp());
    const made = await store.put(event({
      attendees: [{ email: 'Paul@Example.com', status: 'NEEDS-ACTION' }],
    }));

    await store.recordResponse(made.uid, 'paul@example.com', 'DECLINED');
    expect((await store.find(made.uid))?.attendees?.[0]?.status).toBe('DECLINED');
  });

  it('does not bump the sequence — a reply is not a change to the meeting', async () => {
    // Bumping it would tell every other invitee to refresh for nothing.
    const store = await storeIn(await temp());
    const made = await store.put(event({ sequence: 2, attendees: [{ email: 'p@e.com', status: 'NEEDS-ACTION' }] }));

    await store.recordResponse(made.uid, 'p@e.com', 'ACCEPTED');
    expect((await store.find(made.uid))?.sequence).toBe(2);
  });

  it('says nothing to record when the event is unknown', async () => {
    const store = await storeIn(await temp());
    expect(await store.recordResponse('nope', 'p@e.com', 'ACCEPTED')).toBeNull();
  });
});

describe('what counts as overlapping', () => {
  it('counts a genuine clash', () => {
    expect(overlaps(event({ start: at(9), end: at(10) }), at(9, 30), at(11))).toBe(true);
  });

  it('does not count meetings that merely touch', () => {
    // Back to back is not a clash, and treating it as one loses every slot.
    expect(overlaps(event({ start: at(9), end: at(10) }), at(10), at(11))).toBe(false);
  });

  it('counts an event that swallows the window whole', () => {
    expect(overlaps(event({ start: at(8), end: at(18) }), at(9), at(10))).toBe(true);
  });
});

describe('deciding whether a slot is taken', () => {
  it('ignores a cancelled meeting', () => {
    expect(isBusy(event({ status: 'CANCELLED' }))).toBe(false);
  });

  it('ignores one this agent declined', () => {
    const declined = event({ attendees: [{ email: 'me@hats', status: 'DECLINED' }] });
    expect(isBusy(declined, 'me@hats')).toBe(false);
  });

  it('still counts one this agent accepted', () => {
    const accepted = event({ attendees: [{ email: 'me@hats', status: 'ACCEPTED' }] });
    expect(isBusy(accepted, 'me@hats')).toBe(true);
  });

  it('counts one somebody else declined', () => {
    const theirs = event({ attendees: [{ email: 'them@hats', status: 'DECLINED' }] });
    expect(isBusy(theirs, 'me@hats')).toBe(true);
  });
});

describe('finding a free hour', () => {
  const busy = (from: number, to: number) => event({ start: at(from), end: at(to) });

  it('offers the start of the window when nothing is booked', () => {
    const slot = firstFreeSlot([], at(9), at(17), 60);
    expect(slot?.start.toISOString()).toBe(at(9).toISOString());
  });

  it('skips past a meeting in the way', () => {
    const slot = firstFreeSlot([busy(9, 10)], at(9), at(17), 60);
    expect(slot?.start.toISOString()).toBe(at(10).toISOString());
  });

  it('finds a gap between two meetings', () => {
    const slot = firstFreeSlot([busy(9, 10), busy(11, 12)], at(9), at(17), 60);
    expect(slot?.start.toISOString()).toBe(at(10).toISOString());
  });

  it('steps over a gap too short to use', () => {
    // 10:00-10:30 is free but an hour will not fit, so the answer is 11:00.
    const half = event({ start: at(10, 30), end: at(11) });
    const slot = firstFreeSlot([busy(9, 10), half], at(9), at(17), 60);

    expect(slot?.start.toISOString()).toBe(at(11).toISOString());
  });

  it('does take a gap that is exactly long enough', () => {
    const slot = firstFreeSlot([busy(9, 10), busy(11, 12)], at(9), at(17), 60);
    expect(slot?.start.toISOString()).toBe(at(10).toISOString());
  });

  it('handles overlapping meetings without landing inside one', () => {
    const slot = firstFreeSlot([busy(9, 11), busy(10, 12)], at(9), at(17), 60);
    expect(slot?.start.toISOString()).toBe(at(12).toISOString());
  });

  it('says there is no slot when the day is full', () => {
    expect(firstFreeSlot([busy(9, 17)], at(9), at(17), 60)).toBeNull();
  });

  it('will not offer a slot that runs past the end of the window', () => {
    // Free from 16:00, but 90 minutes does not fit before 17:00.
    expect(firstFreeSlot([busy(9, 16)], at(9), at(17), 90)).toBeNull();
  });

  it('ignores a meeting outside the window entirely', () => {
    const slot = firstFreeSlot([busy(6, 8)], at(9), at(17), 60);
    expect(slot?.start.toISOString()).toBe(at(9).toISOString());
  });

  it('works through the store', async () => {
    const store = await storeIn(await temp());
    await store.put(busy(9, 10));
    expect((await store.freeSlot(at(9), at(17), 60))?.start.toISOString())
      .toBe(at(10).toISOString());
  });
});

describe('a uid', () => {
  it('is unique and says where it came from', () => {
    expect(newUid()).not.toBe(newUid());
    expect(newUid()).toMatch(/@hats$/);
  });
});
