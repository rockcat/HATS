import { describe, expect, it } from 'vitest';
import { describeResult } from './visit-coordinator.js';

describe('describeResult', () => {
  it('gives the outcome, what was found, and what is left', () => {
    expect(describeResult({
      host: 'billing',
      result: { outcome: 'partial', summary: 'Totals for May and June.', remaining: 'July', reason: 'July is not closed yet' },
      ended: { by: 'finished' },
    })).toBe('Result of the visit to billing (partial): Totals for May and June.\nStill to do: July\nWhy: July is not closed yet');
  });

  it('says when the visit ended early, and why', () => {
    expect(describeResult({
      host: 'billing', result: { outcome: 'failed', summary: 'Nothing yet.' }, ended: { by: 'recalled', note: 'needed back' },
    })).toContain('The visit ended early: recalled, needed back.');
  });

  it('says plainly when there was no result', () => {
    expect(describeResult({ host: 'billing' })).toBe('The visit to billing ended without a result.');
  });
});
