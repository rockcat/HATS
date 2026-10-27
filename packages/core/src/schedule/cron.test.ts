import { describe, it, expect } from 'vitest';
import { nextCronRun, cronError, parseCron } from './cron.js';

// Local-time dates, as the runner sees them.
const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const next = (expr: string, from: number) => {
  const n = nextCronRun(expr, from);
  return n === null ? null : new Date(n);
};

describe('the next run of a cron expression', () => {
  it('is later today when the time has not come yet', () => {
    expect(next('30 9 * * *', at(2026, 10, 27, 8, 0))).toEqual(new Date(at(2026, 10, 27, 9, 30)));
  });

  it('is tomorrow once today\'s time has passed — including exactly now', () => {
    expect(next('30 9 * * *', at(2026, 10, 27, 9, 30))).toEqual(new Date(at(2026, 10, 28, 9, 30)));
  });

  it('skips the weekend for weekdays', () => {
    // Fri 30 Oct 2026, after 9 → Mon 2 Nov
    expect(next('0 9 * * 1-5', at(2026, 10, 30, 10, 0))).toEqual(new Date(at(2026, 11, 2, 9, 0)));
  });

  it('understands names, steps and lists', () => {
    expect(next('0 18 * * fri', at(2026, 10, 27))).toEqual(new Date(at(2026, 10, 30, 18, 0)));
    expect(next('*/15 * * * *', at(2026, 10, 27, 9, 7))).toEqual(new Date(at(2026, 10, 27, 9, 15)));
    expect(next('0 8,12,17 * * *', at(2026, 10, 27, 12, 30))).toEqual(new Date(at(2026, 10, 27, 17, 0)));
  });

  it('runs on either day when both day fields are given, as cron does', () => {
    // The 1st or any Monday: from Tue 27 Oct, Sun 1 Nov comes before Mon 2 Nov.
    expect(next('0 9 1 * mon', at(2026, 10, 27))).toEqual(new Date(at(2026, 11, 1, 9, 0)));
  });

  it('treats 7 as Sunday', () => {
    expect(parseCron('0 9 * * 7').weekdays.has(0)).toBe(true);
  });

  it('is null for a date that never comes', () => {
    expect(nextCronRun('0 9 30 2 *', at(2026, 1, 1))).toBeNull();
  });
});

describe('a bad expression', () => {
  it('is explained', () => {
    expect(cronError('0 9 * *')).toMatch(/five fields/);
    expect(cronError('0 25 * * *')).toMatch(/hour/);
    expect(cronError('0 9 * * funday')).toMatch(/day of week/);
    expect(cronError('5-1 * * * *')).toMatch(/backwards/);
    expect(cronError('0 9 * * 1-5')).toBeNull();
  });
});
