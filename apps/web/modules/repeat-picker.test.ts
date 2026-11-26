import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain browser module; these helpers do not touch the DOM.
import { readCron, makeCron, repeatText } from './repeat-picker.js';

describe('picked times as cron', () => {
  it('round-trips daily, weekdays and weekly', () => {
    for (const [kind, day] of [['daily', 1], ['weekdays', 1], ['weekly', 5]] as const) {
      const cron = makeCron(kind, '07:05', day);
      expect(readCron(cron)).toEqual(kind === 'weekly' ? { kind, time: '07:05', day } : { kind, time: '07:05' });
    }
  });

  it('writes the expression the runner expects', () => {
    expect(makeCron('weekdays', '08:30')).toBe('30 8 * * 1-5');
    expect(makeCron('weekly', '18:00', 0)).toBe('0 18 * * 0');
  });

  it('leaves anything else as a raw expression', () => {
    expect(readCron('*/15 9-17 * * 1-5')).toBeNull();
  });
});

describe('how a task repeats, in words', () => {
  it('names each kind', () => {
    expect(repeatText({ intervalSeconds: null })).toBe('Once');
    expect(repeatText({ intervalSeconds: 900 })).toBe('Every 15 min');
    expect(repeatText({ intervalSeconds: 7200 })).toBe('Every 2 h');
    expect(repeatText({ cron: '0 9 * * *' })).toBe('Daily at 09:00');
    expect(repeatText({ cron: '30 8 * * 1-5' })).toBe('Weekdays at 08:30');
    expect(repeatText({ cron: '0 18 * * 5' })).toBe('Fridays at 18:00');
    expect(repeatText({ cron: '*/15 9-17 * * 1-5' })).toBe('Cron */15 9-17 * * 1-5');
  });

  it('prefers the cron when a task somehow has both', () => {
    expect(repeatText({ intervalSeconds: 900, cron: '0 9 * * *' })).toBe('Daily at 09:00');
  });
});
