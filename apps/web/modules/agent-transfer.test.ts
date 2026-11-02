import { describe, it, expect } from 'vitest';
import { downloadName, freeName } from './agent-transfer.js';

describe('a free name for a copy', () => {
  it('numbers it after the original', () => {
    expect(freeName('Poppy', ['Poppy'])).toBe('Poppy 2');
  });

  it('skips numbers already used, whatever their case', () => {
    expect(freeName('Poppy', ['Poppy', 'poppy 2', 'POPPY 3'])).toBe('Poppy 4');
  });

  it('counts on from a copy rather than adding another number', () => {
    expect(freeName('Poppy 2', ['Poppy', 'Poppy 2'])).toBe('Poppy 3');
  });
});

describe('the name a download was offered under', () => {
  it('is read from the header', () => {
    expect(downloadName('attachment; filename="Poppy.hats-agent.zip"', 'x.zip')).toBe('Poppy.hats-agent.zip');
  });

  it('falls back when there is none', () => {
    expect(downloadName(null, 'x.zip')).toBe('x.zip');
  });
});
