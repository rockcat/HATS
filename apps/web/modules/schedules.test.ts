import { describe, it, expect } from 'vitest';
// @ts-expect-error — a browser module; collectMcpArgs only reads the inputs it is handed.
import { collectMcpArgs } from './schedules.js';

/** Stands in for the parameter form: all collectMcpArgs touches is its inputs. */
const form = (fields: { key: string; type: string; value: string }[]) => ({
  querySelectorAll: () => fields.map((f) => ({ value: f.value, dataset: { paramKey: f.key, paramType: f.type } })),
});

describe('collecting a scheduled MCP call\'s arguments', () => {
  it('keeps false, which is a real answer', () => {
    expect(collectMcpArgs(form([{ key: 'seen', type: 'boolean', value: 'false' }]))).toEqual({ seen: false });
  });

  it('skips a field left blank', () => {
    expect(collectMcpArgs(form([{ key: 'seen', type: 'boolean', value: '' }]))).toEqual({});
  });

  it('turns numbers into numbers and drops ones that are not', () => {
    expect(collectMcpArgs(form([
      { key: 'page', type: 'integer', value: '2' },
      { key: 'pageSize', type: 'number', value: 'ten' },
    ]))).toEqual({ page: 2 });
  });
});
