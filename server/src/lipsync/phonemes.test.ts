import { describe, it, expect } from 'vitest';
import { textToPhonemes } from './phonemes.js';

describe('textToPhonemes', () => {
  it('returns phoneme entries for known words', async () => {
    const entries = await textToPhonemes('hello');
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]).toHaveProperty('phoneme');
    expect(entries[0]).toHaveProperty('viseme');
  });

  it('all entries have valid viseme ids', async () => {
    const validVisemes = new Set(['rest', 'AI', 'E', 'O', 'U', 'MBP', 'FV', 'LDN', 'WQ', 'SZ']);
    const entries = await textToPhonemes('the quick brown fox jumps');
    for (const entry of entries) {
      expect(validVisemes.has(entry.viseme)).toBe(true);
    }
  });

  it('handles unknown words gracefully', async () => {
    const entries = await textToPhonemes('xylophoneblarg');
    expect(entries.length).toBeGreaterThan(0);
  });

  it('returns rest entries between words', async () => {
    const entries = await textToPhonemes('hi there');
    const hasRest = entries.some((e) => e.viseme === 'rest');
    expect(hasRest).toBe(true);
  });
});
