import { describe, it, expect } from 'vitest';
// @ts-expect-error — a browser module of pure helpers, so it loads here.
import { fmtAgo, fmtLastRun } from './utils.js';

const now = Date.UTC(2026, 9, 24, 12, 0, 0);
const minsAgo = (m: number) => now - m * 60_000;

describe('how long ago', () => {
  it('reads naturally at each scale', () => {
    expect(fmtAgo(minsAgo(0.5), now)).toBe('just now');
    expect(fmtAgo(minsAgo(5), now)).toBe('5 min ago');
    expect(fmtAgo(minsAgo(185), now)).toBe('3 h ago');
    expect(fmtAgo(minsAgo(60 * 50), now)).toBe('2 d ago');
  });
});

describe('last run', () => {
  it('says so when it never has', () => {
    expect(fmtLastRun(undefined)).toBe('Never run');
  });

  it('names who ran a shared action', () => {
    expect(fmtLastRun(Date.now() - 5 * 60_000, 'Rhoda')).toBe('Last run 5 min ago · Rhoda');
  });
});
