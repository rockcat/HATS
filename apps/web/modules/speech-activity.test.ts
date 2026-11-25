import { describe, it, expect } from 'vitest';
// @ts-expect-error — a browser module, deliberately free of imports so it can be tested here.
import { speechStarted, speechEnded, isSpeechPlaying, TAIL_MS } from './speech-activity.js';

describe('whether an agent is speaking out loud', () => {
  it('is quiet until a clip starts, and for a moment after the last one ends', () => {
    expect(isSpeechPlaying(1e12)).toBe(false);
    speechStarted();
    speechStarted(); // a meeting clip over the dashboard's
    speechEnded(1000);
    expect(isSpeechPlaying(1e12)).toBe(true);
    speechEnded(2000);
    expect(isSpeechPlaying(2000 + TAIL_MS - 1)).toBe(true);
    expect(isSpeechPlaying(2000 + TAIL_MS)).toBe(false);
  });

  it('never counts below nothing', () => {
    speechEnded(0);
    speechStarted();
    expect(isSpeechPlaying(1e12)).toBe(true);
    speechEnded(0);
  });
});
