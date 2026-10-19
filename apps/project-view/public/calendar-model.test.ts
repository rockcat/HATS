import { describe, it, expect } from 'vitest';
// @ts-expect-error — a browser module with no imports, so it loads here.
import {
  DAY_END_HOUR, DAY_START_HOUR, addDays, agenda, daysInView, defaultMeetingTime,
  hourRows, meetingsOn, outsideHours, placeInDay, startOfDay, startOfWeek, step,
  titleFor, whenOf,
} from './calendar-model.js';

/** Local time, because that is what a calendar is read in. */
const at = (iso: string) => new Date(iso);
const meeting = (iso: string, over: Record<string, unknown> = {}) =>
  ({ id: iso, topic: 'Standup', scheduledFor: new Date(iso).toISOString(), ...over });

describe('finding the start of things', () => {
  it('strips the time from a day', () => {
    const d = startOfDay(at('2026-10-21T15:42:10'));
    expect([d.getHours(), d.getMinutes(), d.getSeconds()]).toEqual([0, 0, 0]);
    expect(d.getDate()).toBe(21);
  });

  it('starts the week on Monday', () => {
    // Wednesday 21 October 2026 → Monday 19th.
    expect(startOfWeek(at('2026-10-21T12:00')).getDate()).toBe(19);
  });

  it('pulls Sunday back six days, not forward one', () => {
    // getDay() calls Sunday 0, which is the classic off-by-one that leaves a
    // week view showing the wrong seven days.
    const sunday = at('2026-10-25T12:00');
    expect(sunday.getDay()).toBe(0);
    expect(startOfWeek(sunday).getDate()).toBe(19);
  });

  it('leaves a Monday where it is', () => {
    expect(startOfWeek(at('2026-10-19T12:00')).getDate()).toBe(19);
  });

  it('crosses a month boundary correctly', () => {
    // Thursday 1 October 2026 → Monday 28 September.
    const monday = startOfWeek(at('2026-10-01T12:00'));
    expect(monday.getDate()).toBe(28);
    expect(monday.getMonth()).toBe(8);   // September
  });
});

describe('which days a view covers', () => {
  it('gives a week seven days from Monday', () => {
    const days = daysInView('week', at('2026-10-21T12:00'));
    expect(days).toHaveLength(7);
    expect(days[0].getDate()).toBe(19);
    expect(days[6].getDate()).toBe(25);
  });

  it('gives a day exactly one', () => {
    const days = daysInView('day', at('2026-10-21T12:00'));
    expect(days).toHaveLength(1);
    expect(days[0].getDate()).toBe(21);
  });
});

describe('moving around', () => {
  it('steps a week at a time in the week view', () => {
    expect(step('week', at('2026-10-21T12:00'), 1).getDate()).toBe(28);
    expect(step('week', at('2026-10-21T12:00'), -1).getDate()).toBe(14);
  });

  it('steps a day at a time in the day view', () => {
    expect(step('day', at('2026-10-21T12:00'), 1).getDate()).toBe(22);
  });

  it('survives a month end', () => {
    const next = step('day', at('2026-10-31T12:00'), 1);
    expect(next.getDate()).toBe(1);
    expect(next.getMonth()).toBe(10);
  });

  it('does not mutate the date it was given', () => {
    const focus = at('2026-10-21T12:00');
    addDays(focus, 7);
    expect(focus.getDate()).toBe(21);
  });
});

describe('which meetings fall on a day', () => {
  const meetings = [
    meeting('2026-10-21T09:00'),
    meeting('2026-10-21T15:00'),
    meeting('2026-10-22T09:00'),
  ];

  it('picks only that day, earliest first', () => {
    const on = meetingsOn(meetings, at('2026-10-21T00:00'));
    expect(on).toHaveLength(2);
    expect(whenOf(on[0]).getHours()).toBe(9);
  });

  it('is empty for a day with nothing', () => {
    expect(meetingsOn(meetings, at('2026-10-23T00:00'))).toEqual([]);
  });

  it('ignores a meeting with no usable date', () => {
    expect(meetingsOn([{ id: 'x', scheduledFor: 'soon' }], at('2026-10-21T00:00'))).toEqual([]);
  });

  it('copes with nothing at all', () => {
    expect(meetingsOn(undefined, at('2026-10-21T00:00'))).toEqual([]);
  });
});

describe('placing a meeting in the day grid', () => {
  it('puts the start of the day at the top', () => {
    const place = placeInDay(meeting(`2026-10-21T0${DAY_START_HOUR}:00`));
    expect(place.top).toBeCloseTo(0, 5);
  });

  it('puts midday around the middle', () => {
    const place = placeInDay(meeting('2026-10-21T14:00'));
    expect(place.top).toBeGreaterThan(0.4);
    expect(place.top).toBeLessThan(0.6);
  });

  it('gives a longer meeting more height', () => {
    const short = placeInDay(meeting('2026-10-21T10:00', { durationMinutes: 15 }));
    const long = placeInDay(meeting('2026-10-21T10:00', { durationMinutes: 90 }));
    expect(long.height).toBeGreaterThan(short.height);
  });

  it('never runs a meeting off the bottom', () => {
    const place = placeInDay(meeting(`2026-10-21T${DAY_END_HOUR - 1}:30`, { durationMinutes: 240 }));
    expect(place.top + place.height).toBeLessThanOrEqual(1.0001);
  });

  it('reports an early meeting as unplaceable rather than moving it', () => {
    // Clamping a 03:00 meeting to the top would quietly claim it is at 07:00.
    expect(placeInDay(meeting('2026-10-21T03:00'))).toBeNull();
  });

  it('reports a late meeting as unplaceable too', () => {
    expect(placeInDay(meeting(`2026-10-21T${DAY_END_HOUR}:30`))).toBeNull();
  });

  it('lists what fell outside the hours, so nothing vanishes', () => {
    const meetings = [meeting('2026-10-21T03:00'), meeting('2026-10-21T10:00')];
    const outside = outsideHours(meetings, at('2026-10-21T00:00'));

    expect(outside).toHaveLength(1);
    expect(whenOf(outside[0]).getHours()).toBe(3);
  });
});

describe('the agenda', () => {
  const now = at('2026-10-21T12:00');
  const meetings = [
    meeting('2026-10-20T09:00'),
    meeting('2026-10-22T09:00'),
    meeting('2026-10-25T09:00'),
    { id: 'undated', topic: 'Someday' },
  ];

  it('leads with what is next', () => {
    // An agenda is read to answer "what is next".
    const { upcoming } = agenda(meetings, now);
    expect(whenOf(upcoming[0]).getDate()).toBe(22);
    expect(whenOf(upcoming[1]).getDate()).toBe(25);
  });

  it('puts the most recent past meeting first', () => {
    expect(whenOf(agenda(meetings, now).past[0]).getDate()).toBe(20);
  });

  it('keeps an undated meeting rather than dropping it', () => {
    expect(agenda(meetings, now).undated).toHaveLength(1);
  });

  it('copes with nothing scheduled', () => {
    expect(agenda([], now)).toEqual({ upcoming: [], past: [], undated: [] });
  });
});

describe('the title above it', () => {
  it('names the day in the day view', () => {
    expect(titleFor('day', at('2026-10-21T12:00'))).toContain('21');
  });

  it('spans the week in the week view', () => {
    const title = titleFor('week', at('2026-10-21T12:00'));
    expect(title).toContain('19');
    expect(title).toContain('25');
  });
});

describe('the hour rows', () => {
  it('covers the working day', () => {
    const rows = hourRows();
    expect(rows[0]).toBe(DAY_START_HOUR);
    expect(rows[rows.length - 1]).toBe(DAY_END_HOUR - 1);
  });
});

describe('suggesting a time for a new meeting', () => {
  it('offers the next whole hour', () => {
    expect(defaultMeetingTime(at('2026-10-21T14:37'))).toBe('2026-10-21T15:00');
  });

  it('rolls into the next day late at night', () => {
    expect(defaultMeetingTime(at('2026-10-21T23:30'))).toBe('2026-10-22T00:00');
  });

  it('pads every field, so the input accepts it', () => {
    expect(defaultMeetingTime(at('2026-01-02T08:05'))).toBe('2026-01-02T09:00');
  });
});
