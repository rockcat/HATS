import { describe, it, expect } from 'vitest';
import { parseLimits } from './agent-limits.js';
import { limitValue } from '../../../apps/web/modules/agent-limits.js';

describe("a project agent's limits", () => {
  it('sets what is given and leaves out what is not', () => {
    expect(parseLimits({ maxCostPerHour: 2.5 })).toEqual({ maxCostPerHour: 2.5 });
    expect(parseLimits({})).toEqual({});
  });

  it('removes a limit sent as null or empty', () => {
    const patch = parseLimits({ maxCostPerHour: null, maxContextTokens: '' });
    expect('maxCostPerHour' in patch && patch.maxCostPerHour).toBeUndefined();
    expect('maxContextTokens' in patch).toBe(true);
  });

  it('rounds context tokens to a whole number', () => {
    expect(parseLimits({ maxContextTokens: '32000.4' })).toEqual({ maxContextTokens: 32000 });
  });

  it('refuses zero, negatives and text', () => {
    expect(() => parseLimits({ maxCostPerHour: 0 })).toThrow(/positive/);
    expect(() => parseLimits({ maxCostPerHour: -1 })).toThrow(/positive/);
    expect(() => parseLimits({ maxContextTokens: 'lots' })).toThrow(/positive/);
  });
});

describe('the Configure panel limit fields', () => {
  it('send empty as no limit and anything else as a number', () => {
    expect(limitValue('')).toBeNull();
    expect(limitValue('  ')).toBeNull();
    expect(limitValue('1.5')).toBe(1.5);
  });
});
