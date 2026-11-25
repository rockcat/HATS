import { describe, it, expect } from 'vitest';
import { keepSegments, laterText, CUT } from './record-cuts.mjs';

describe('cutting the waits out of a recording', () => {
  it('keeps everything when nothing waited long', () => {
    expect(keepSegments([{ from: 1000, to: 5000 }], 20_000)).toEqual([{ start: 0, end: 20_000 }]);
  });

  it("drops a long wait's middle, keeping its start and end", () => {
    expect(keepSegments([{ from: 10_000, to: 70_000 }], 80_000)).toEqual([
      { start: 0, end: 10_000 + CUT.head },
      { start: 70_000 - CUT.tail, end: 80_000 },
    ]);
  });

  it('handles several waits, in any order, and one running to the end', () => {
    const keep = keepSegments([{ from: 50_000, to: 100_000 }, { from: 5_000, to: 30_000 }], 100_000);
    expect(keep).toEqual([
      { start: 0, end: 5_000 + CUT.head },
      { start: 30_000 - CUT.tail, end: 50_000 + CUT.head },
      { start: 100_000 - CUT.tail, end: 100_000 },
    ]);
  });

  it('says how long a wait was', () => {
    expect(laterText(150_000)).toBe('3 min later');
    expect(laterText(42_000)).toBe('42 s later');
  });
});
