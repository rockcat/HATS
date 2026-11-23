import { describe, expect, it } from 'vitest';
import { drainAgents, type Drainable } from './drain.js';

/** An agent that stays busy for `turns` polls after being told to stop. */
function agent(name: string, turns: number) {
  let left = turns;
  const a = {
    name,
    stopped: false,
    get busy() { return left > 0; },
    stop() { a.stopped = true; },
    tick() { if (left > 0) left--; },
  };
  return a;
}

/** A clock that moves on by each sleep, ticking every agent. */
function clock(agents: Array<{ tick(): void }>) {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => { t += ms; for (const a of agents) a.tick(); } };
}

describe('drainAgents', () => {
  it('stops every agent and waits until none is busy', async () => {
    const team = [agent('Ann', 3), agent('Bo', 0)];
    const unfinished = await drainAgents(team as Drainable[], 1_000, { pollMs: 100, ...clock(team) });
    expect(team.every((a) => a.stopped)).toBe(true);
    expect(unfinished).toEqual([]);
  });

  it('gives up at the limit and names who was still busy', async () => {
    const team = [agent('Ann', 50), agent('Bo', 1)];
    const unfinished = await drainAgents(team as Drainable[], 500, { pollMs: 100, ...clock(team) });
    expect(unfinished).toEqual(['Ann']);
  });

  it('returns at once when nobody is busy', async () => {
    const team = [agent('Ann', 0)];
    const c = clock(team);
    await drainAgents(team as Drainable[], 10_000, { pollMs: 100, ...c });
    expect(c.now()).toBe(0);
  });
});
