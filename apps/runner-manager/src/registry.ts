// ── Which runners exist ──────────────────────────────────────────────────────
//
// Two sources, merged. Every runner reports in on a timer, wherever it runs:
// this manager's own containers, runners in a hand-written compose file, a
// source checkout. Containers this manager started are also listed from
// Docker, so one that is stopped, or still starting, shows up too.

import type { TeamCard } from '@hats/contracts/types';
import type { Heartbeat, ManagedContainer, RunnerInfo } from './types.js';

/** A runner that has not reported in for this long is shown as unreachable. */
export const STALE_AFTER_MS = 90_000;

/** A report-in as remembered: when, and whether the runner has since stopped or is restarting. */
export type Seen = Heartbeat & { at: number; stopped?: boolean; starting?: boolean };

export class Registry {
  private readonly seen = new Map<string, Seen>();

  constructor(private readonly now: () => number = Date.now) {}

  heartbeat(beat: Heartbeat): void {
    this.seen.set(beat.project.toLowerCase(), { ...beat, at: this.now() });
  }

  /** A runner stopping on purpose: shown as stopped at once, not as unreachable later. */
  goodbye(project: string): void {
    const key = project.toLowerCase();
    const known = this.seen.get(key);
    if (known) this.seen.set(key, { ...known, at: this.now(), stopped: true });
  }

  /** A stopped runner started again: shown as starting until it reports in. */
  starting(project: string): void {
    const key = project.toLowerCase();
    const known = this.seen.get(key);
    if (known) this.seen.set(key, { ...known, at: this.now(), stopped: false, starting: true });
  }

  /** Forget a runner, as when its container is removed. */
  forget(project: string): void {
    this.seen.delete(project.toLowerCase());
  }

  /** The cards of teams whose runners are up: reported in lately, and not since stopped. */
  cards(): TeamCard[] {
    const now = this.now();
    return [...this.seen.values()]
      .filter((s) => s.card && !s.stopped && now - s.at < STALE_AFTER_MS)
      .map((s) => s.card!);
  }

  /** Every runner known, one per project, sorted by project. */
  list(containers: ManagedContainer[]): RunnerInfo[] {
    return mergeRunners([...this.seen.values()], containers, this.now());
  }
}

/** Combine heartbeats and containers into one entry per project. Pure. */
export function mergeRunners(beats: Seen[], containers: ManagedContainer[], now: number): RunnerInfo[] {
  const byProject = new Map<string, RunnerInfo>();
  const fresh = (at: number) => now - at < STALE_AFTER_MS;

  for (const beat of beats) {
    byProject.set(beat.project.toLowerCase(), {
      project: beat.project,
      port: beat.port,
      ...(beat.url && { url: beat.url }),
      ...(beat.container && { container: beat.container }),
      status: beat.stopped ? 'stopped' : beat.starting ? 'starting' : fresh(beat.at) ? 'running' : 'unreachable',
      managed: false,
      lastSeen: new Date(beat.at).toISOString(),
    });
  }

  for (const c of containers) {
    const key = c.project.toLowerCase();
    const reported = byProject.get(key);
    // Docker knows whether the container runs; a goodbye still counts while
    // the container is on its way down.
    const status: RunnerInfo['status'] = !c.running || reported?.status === 'stopped' ? 'stopped'
      : reported?.status === 'running' ? 'running' : 'starting';
    byProject.set(key, {
      ...reported, project: reported?.project ?? c.project, port: c.port, status, managed: true, container: c.id,
    });
  }

  return [...byProject.values()].sort((a, b) => a.project.localeCompare(b.project));
}

/** The lowest port in [from, to] that no runner uses, or null if all are taken. */
export function freePort(used: Iterable<number>, from: number, to: number): number | null {
  const taken = new Set(used);
  for (let port = from; port <= to; port++) if (!taken.has(port)) return port;
  return null;
}
