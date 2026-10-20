// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
// @ts-expect-error - plain JS module, shipped to the browser as-is
import { HandsFree, Mode, worthSending } from './hands-free.js';

/** A clock we can wind forward, so a pause costs no real time. */
class FakeTimers {
  private at = new Map<number, () => void>();
  private next = 1;
  setTimeout = (fn: () => void) => { const id = this.next++; this.at.set(id, fn); return id; };
  clearTimeout = (id: number) => { this.at.delete(id); };
  /** Fire everything currently scheduled, as a long enough pause would. */
  pass() {
    const due = [...this.at.values()];
    this.at.clear();
    for (const fn of due) fn();
  }
  get pending() { return this.at.size; }
}

/** Stands in for the browser's recogniser. */
class FakeListener {
  isListening = false;
  cleared = 0;
  starts = 0;
  cancels = 0;
  start() { this.starts++; this.isListening = true; }
  stop() { this.isListening = false; return ''; }
  cancel() { this.cancels++; this.isListening = false; }
  clear() { this.cleared++; }
  /** What the real one does when Chrome ends the session: idle, then tell us. */
  endsOnItsOwn(hf: { recogniserEnded(): void }) { this.isListening = false; hf.recogniserEnded(); }
}

let listener: FakeListener;
let timers: FakeTimers;
let sent: string[];
let modes: string[];
let hf: InstanceType<typeof HandsFree>;

beforeEach(() => {
  listener = new FakeListener();
  timers = new FakeTimers();
  sent = [];
  modes = [];
  hf = new HandsFree({
    listener,
    onUtterance: (text: string) => sent.push(text),
    onMode: (mode: string) => modes.push(mode),
    timers,
  });
});

describe('deciding what is worth sending', () => {
  it('sends a sentence', () => {
    expect(worthSending('what is on my calendar today')).toBe(true);
  });

  it('sends short but real replies', () => {
    // These are complete answers to an agent's question. Dropping them as
    // "too short" makes it ask again, which is worse than a stray noise.
    for (const word of ['yes', 'no', 'ok', 'stop', 'both']) {
      expect(worthSending(word), word).toBe(true);
    }
  });

  it('drops noises', () => {
    for (const noise of ['um', 'uh', 'mm', 'hmm', 'er', 'uh um', '  ']) {
      expect(worthSending(noise), noise).toBe(false);
    }
  });

  it('keeps a sentence that merely starts with a noise', () => {
    expect(worthSending('um what time is it')).toBe(true);
  });

  it('drops punctuation on its own', () => {
    expect(worthSending('...')).toBe(false);
    expect(worthSending('?')).toBe(false);
  });
});

describe('waiting for the pause that ends a sentence', () => {
  it('does not send on a final result alone', () => {
    // The recogniser marks several results final inside one spoken sentence.
    hf.enable();
    hf.heard('book a meeting', true);
    expect(sent).toEqual([]);
  });

  it('sends once the pause has run', () => {
    hf.enable();
    hf.heard('book a meeting', true);
    timers.pass();
    expect(sent).toEqual(['book a meeting']);
  });

  it('sends the whole sentence, not the first half', () => {
    hf.enable();
    hf.heard('book a meeting', true);
    hf.heard('book a meeting with Paul', false);
    hf.heard('book a meeting with Paul tomorrow', true);
    timers.pass();
    expect(sent).toEqual(['book a meeting with Paul tomorrow']);
  });

  it('starts the next sentence clean', () => {
    hf.enable();
    hf.heard('hello', true);
    timers.pass();
    hf.heard('what is the time', true);
    timers.pass();
    expect(sent).toEqual(['hello', 'what is the time']);
  });

  it('wipes the recogniser between sentences', () => {
    // Otherwise a continuous session keeps handing back everything it has
    // ever heard and the second message contains the first.
    hf.enable();
    const before = listener.cleared;
    hf.heard('hello', true);
    timers.pass();
    expect(listener.cleared).toBeGreaterThan(before);
  });

  it('swallows a noise without sending it', () => {
    hf.enable();
    hf.heard('um', true);
    timers.pass();
    expect(sent).toEqual([]);
  });

  it('is ready again after swallowing one', () => {
    hf.enable();
    hf.heard('um', true);
    timers.pass();
    hf.heard('right, go on', true);
    timers.pass();
    expect(sent).toEqual(['right, go on']);
  });
});

describe('not answering itself', () => {
  it('shuts the microphone while the agent talks', () => {
    hf.enable();
    const before = listener.cancels;
    hf.hold();
    expect(listener.cancels).toBeGreaterThan(before);
    expect(hf.mode).toBe(Mode.held);
  });

  it('ignores anything heard while held', () => {
    hf.enable();
    hf.hold();
    hf.heard('that would be the sound of my own voice', true);
    timers.pass();
    expect(sent).toEqual([]);
  });

  it('drops a half-heard sentence rather than sending it later', () => {
    // Whatever is in the buffer when the agent starts speaking is as likely
    // to be the start of its own reply as anything the user said.
    hf.enable();
    hf.heard('wait', false);
    hf.hold();
    hf.release();
    timers.pass();
    expect(sent).toEqual([]);
  });

  it('listens again when it has finished', () => {
    hf.enable();
    hf.hold();
    const before = listener.starts;
    hf.release();
    expect(listener.starts).toBeGreaterThan(before);
    expect(hf.mode).toBe(Mode.open);
  });

  it('stays deaf until the last sentence of the reply is out', () => {
    // A reply is spoken one sentence at a time, so holds nest. A boolean
    // would reopen the mic on the first sentence finishing.
    hf.enable();
    hf.hold();
    hf.hold();
    hf.hold();
    hf.release();
    hf.release();
    expect(hf.mode).toBe(Mode.held);
    hf.release();
    expect(hf.mode).toBe(Mode.open);
  });

  it('does not go negative on a stray release', () => {
    hf.enable();
    hf.release();
    hf.hold();
    expect(hf.mode).toBe(Mode.held);
    hf.release();
    expect(hf.mode).toBe(Mode.open);
  });
});

describe('staying switched on', () => {
  it('restarts when the recogniser gives up on its own', () => {
    // Chrome ends a continuous session after a long silence. Without this,
    // the microphone quietly stops working a few minutes in.
    hf.enable();
    const before = listener.starts;
    listener.endsOnItsOwn(hf);
    expect(listener.starts).toBeGreaterThan(before);
  });

  it('does not restart when it was switched off', () => {
    hf.enable();
    hf.disable();
    const before = listener.starts;
    listener.endsOnItsOwn(hf);
    expect(listener.starts).toBe(before);
  });

  it('does not restart while the agent is speaking', () => {
    hf.enable();
    hf.hold();
    const before = listener.starts;
    listener.endsOnItsOwn(hf);
    expect(listener.starts).toBe(before);
  });
});

describe('switching it off', () => {
  it('closes the microphone', () => {
    hf.enable();
    const before = listener.cancels;
    hf.disable();
    expect(listener.cancels).toBeGreaterThan(before);
    expect(hf.mode).toBe(Mode.off);
  });

  it('cancels a sentence that was about to be sent', () => {
    hf.enable();
    hf.heard('forget it', true);
    hf.disable();
    timers.pass();
    expect(sent).toEqual([]);
  });

  it('leaves no timer running', () => {
    hf.enable();
    hf.heard('something', true);
    hf.disable();
    expect(timers.pending).toBe(0);
  });

  it('toggles', () => {
    expect(hf.toggle()).toBe(true);
    expect(hf.enabled).toBe(true);
    expect(hf.toggle()).toBe(false);
    expect(hf.enabled).toBe(false);
  });

  it('hears nothing when it was never switched on', () => {
    hf.heard('hello', true);
    timers.pass();
    expect(sent).toEqual([]);
  });
});

describe('typing over what was heard', () => {
  it('does not also send the spoken version a beat later', () => {
    hf.enable();
    hf.heard('book a meting', true);
    hf.dismiss();
    timers.pass();
    expect(sent).toEqual([]);
  });

  it('keeps listening afterwards', () => {
    hf.enable();
    hf.heard('book a meting', true);
    hf.dismiss();
    expect(hf.enabled).toBe(true);
    hf.heard('book a meeting', true);
    timers.pass();
    expect(sent).toEqual(['book a meeting']);
  });
});
