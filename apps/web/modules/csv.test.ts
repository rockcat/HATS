import { describe, it, expect } from 'vitest';
// @ts-expect-error — a browser module, deliberately free of imports so it can be tested here.
import { parseCsv } from './csv.js';

describe('reading CSV', () => {
  it('reads rows and fields', () => {
    expect(parseCsv('date,region\n2026-07-01,UK\n').rows).toEqual([['date', 'region'], ['2026-07-01', 'UK']]);
  });

  it('handles quotes, commas and line breaks inside them, and \\r\\n', () => {
    const { rows } = parseCsv('name,note\r\n"Smith, J","said ""hi""\nthen left"\r\n');
    expect(rows).toEqual([['name', 'note'], ['Smith, J', 'said "hi"\nthen left']]);
  });

  it('keeps empty fields, and skips blank lines', () => {
    expect(parseCsv('a,,c\n\n1,2,\n').rows).toEqual([['a', '', 'c'], ['1', '2', '']]);
  });

  it('stops at a limit, but counts every row', () => {
    expect(parseCsv('h\n1\n2\n3', 2)).toEqual({ rows: [['h'], ['1']], total: 4 });
  });
});
