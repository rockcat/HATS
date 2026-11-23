/**
 * Stopping a team without cutting anyone off mid-turn.
 *
 * Each agent is told to stop: it takes no new message, and a turn in progress
 * ends at its next step rather than running through all its tool rounds.
 * Then this waits, up to a limit, until none is still busy, so what they were
 * doing is in their threads when the team is saved.
 */

export interface Drainable {
  readonly name: string;
  readonly busy: boolean;
  stop(): void;
}

export interface DrainOptions {
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Stop every agent and wait for them. Returns the names of any still busy when time ran out. */
export async function drainAgents(agents: Drainable[], timeoutMs: number, o: DrainOptions = {}): Promise<string[]> {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pollMs = o.pollMs ?? 100;

  for (const agent of agents) agent.stop();
  const deadline = now() + timeoutMs;
  let busy = agents.filter((a) => a.busy);
  while (busy.length > 0 && now() < deadline) {
    await sleep(pollMs);
    busy = busy.filter((a) => a.busy);
  }
  return busy.map((a) => a.name);
}
