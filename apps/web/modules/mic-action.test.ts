import { describe, it, expect } from 'vitest';
// @ts-expect-error — a browser module, deliberately free of imports so it can be tested here.
import { micAction, HOLD_MS } from './mic-action.js';

const idle = { recording: false, heldMs: 0, latched: false };

describe('deciding what a press or release of the mic means', () => {
  it('starts recording on a press', () => {
    expect(micAction('press', idle)).toBe('start');
  });

  it('stops on a press while already recording', () => {
    // The second click of click-to-start.
    expect(micAction('press', { ...idle, recording: true })).toBe('stop');
  });

  it('stops on release after a real hold', () => {
    expect(micAction('release', { recording: true, heldMs: HOLD_MS + 50, latched: false }))
      .toBe('stop');
  });

  it('keeps recording when the press was too quick to be a hold', () => {
    // This is the bug: a click used to start a recording and then stop it
    // immediately, producing no audio and saying nothing at all — which looks
    // exactly like a dead button, and a click is what people try first.
    expect(micAction('release', { recording: true, heldMs: 50, latched: false }))
      .toBe('latch');
  });

  it('ignores the release that follows a latching click', () => {
    // Otherwise the mouseup from the *stopping* click would stop it twice.
    expect(micAction('release', { recording: true, heldMs: HOLD_MS + 50, latched: true }))
      .toBe('ignore');
  });

  it('ignores a release when nothing is recording', () => {
    // A mouseup anywhere in the window reaches this.
    expect(micAction('release', idle)).toBe('ignore');
  });

  it('treats the boundary as a hold, not a click', () => {
    expect(micAction('release', { recording: true, heldMs: HOLD_MS, latched: false }))
      .toBe('stop');
  });

  it('gives click-start-click-stop a complete round trip', () => {
    // press → start, quick release → latch, press → stop.
    let latched = false;
    expect(micAction('press', { recording: false, heldMs: 0, latched })).toBe('start');

    const afterQuickRelease = micAction('release', { recording: true, heldMs: 20, latched });
    expect(afterQuickRelease).toBe('latch');
    latched = true;

    expect(micAction('press', { recording: true, heldMs: 0, latched })).toBe('stop');
  });

  it('gives hold-to-talk a complete round trip', () => {
    expect(micAction('press', idle)).toBe('start');
    expect(micAction('release', { recording: true, heldMs: 1500, latched: false })).toBe('stop');
  });
});
