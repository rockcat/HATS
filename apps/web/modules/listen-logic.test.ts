import { describe, it, expect } from 'vitest';
// @ts-expect-error — a browser module, deliberately free of imports so it can be tested here.
import { listenTarget, describeTarget, vadStep, VAD, QUIET } from './listen-logic.js';

const page = { meetingOpen: false, view: 'board', chatAgent: null, chatThread: null };

describe('where listen mode sends what is said', () => {
  it('sends nowhere when no chat or meeting is open', () => {
    expect(listenTarget(page)).toBeNull();
  });

  it('sends nowhere from the Chat section with no agent chosen', () => {
    expect(listenTarget({ ...page, view: 'cli' })).toBeNull();
  });

  it('sends nowhere when an agent is chosen but the Chat section is not showing', () => {
    expect(listenTarget({ ...page, chatAgent: 'Poppy' })).toBeNull();
  });

  it("sends to the chosen agent's #general", () => {
    expect(listenTarget({ ...page, view: 'cli', chatAgent: 'Poppy' }))
      .toEqual({ kind: 'agent', agent: 'Poppy', thread: 'general' });
  });

  it('sends to the thread open with that agent', () => {
    expect(listenTarget({ ...page, view: 'cli', chatAgent: 'Poppy', chatThread: 'launch' }))
      .toEqual({ kind: 'agent', agent: 'Poppy', thread: 'launch' });
  });

  it('sends to a meeting on screen, whatever is behind it', () => {
    expect(listenTarget({ ...page, meetingOpen: true, view: 'cli', chatAgent: 'Poppy' }))
      .toEqual({ kind: 'meeting' });
  });

  it('says where it is sending', () => {
    expect(describeTarget(null)).toMatch(/nothing is open/);
    expect(describeTarget({ kind: 'agent', agent: 'Poppy', thread: 'general' })).toBe('talking to Poppy');
    expect(describeTarget({ kind: 'agent', agent: 'Poppy', thread: 'launch' })).toMatch(/thread launch/);
  });
});

describe('telling speech from silence', () => {
  const LOUD = VAD.threshold * 2;
  /** Feed levels at 50 ms steps, returning the events. */
  const run = (levels: number[]) => {
    let at = QUIET;
    const events: string[] = [];
    levels.forEach((level, i) => {
      const step = vadStep(at, level, i * 50);
      at = step.at;
      if (step.event) events.push(step.event);
    });
    return events;
  };
  const quiet = (ms: number) => Array(ms / 50).fill(0);
  const loud = (ms: number) => Array(ms / 50).fill(LOUD);

  it('stays quiet in a quiet room', () => {
    expect(run(quiet(5000))).toEqual([]);
  });

  it('starts on sound and ends after a pause', () => {
    expect(run([...quiet(500), ...loud(1500), ...quiet(VAD.silenceMs + 100)])).toEqual(['start', 'end']);
  });

  it('keeps going through a short pause mid-sentence', () => {
    expect(run([...loud(800), ...quiet(600), ...loud(800), ...quiet(VAD.silenceMs + 100)])).toEqual(['start', 'end']);
  });

  it('throws away a click or a cough', () => {
    expect(run([...loud(100), ...quiet(VAD.silenceMs + 100)])).toEqual(['start', 'discard']);
  });

  it('cuts off someone who never pauses', () => {
    expect(run(loud(VAD.maxMs + 100))).toEqual(['start', 'end', 'start']);
  });
});
