/**
 * Keeping the running team and its project definition in step, both ways.
 *
 * The team can change itself while it runs — agents get added, renamed, retired,
 * the goal gets edited. Those changes belong in the project definition, not only
 * in the runner's local snapshot, so the Designer sees them and the next start
 * reproduces the same team.
 *
 * The Designer changes the definition too. The Project Server announces every
 * save on its change stream, and the runner fetches the newer revision and
 * applies it to the live team; it also looks every few seconds while the
 * stream is down, and every minute while it is up. When both change at
 * once, the Designer's edit is applied first and the runner's write goes on
 * top of it, so neither is lost.
 *
 * Writes are debounced and best-effort: the Project Server being down must never
 * stop a running team.
 */

import type { ProjectServerClient } from '../../../packages/clients/src/project-server-client.js';
import type { DeployedAgent, ProjectDefinition } from '../../../packages/contracts/src/types.js';
import type { TeamOrchestrator } from '../orchestrator/orchestrator.js';
import { liveTeam } from './team-reconcile.js';
import { log } from '../../../packages/core/src/logger.js';

const DEBOUNCE_MS = 2_000;
/** How often to look for the Designer's edits while the change stream is down. */
export const POLL_MS = 5_000;
/** How often to look anyway while it is up, in case a notice was missed. */
export const SLOW_POLL_MS = 60_000;

/** Applies a definition to the live team. `previous` is the team it replaces. */
export type ApplyDefinition = (definition: ProjectDefinition, previous: DeployedAgent[]) => Promise<void>;

export class ProjectSync {
  private readonly client: ProjectServerClient;
  private readonly getOrchestrator: () => TeamOrchestrator;
  private readonly apply: ApplyDefinition;
  private definition: ProjectDefinition;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private poller: ReturnType<typeof setInterval> | null = null;
  private watch: { stop(): void } | null = null;
  private streaming = false;
  private lastPull = 0;
  private inFlight: Promise<void> = Promise.resolve();

  constructor(
    client: ProjectServerClient,
    definition: ProjectDefinition,
    getOrchestrator: () => TeamOrchestrator,
    apply: ApplyDefinition = async () => {},
  ) {
    this.client = client;
    this.definition = definition;
    this.getOrchestrator = getOrchestrator;
    this.apply = apply;
  }

  get projectId(): string { return this.definition.id; }
  get current(): ProjectDefinition { return this.definition; }

  /**
   * Follow the Designer's edits until stopped: at once from the Project
   * Server's change stream, and by looking every `pollMs` while the stream is
   * down, or every `slowPollMs` while it is up.
   */
  start(pollMs = POLL_MS, slowPollMs = SLOW_POLL_MS): void {
    if (this.poller) return;
    this.watch = this.client.watchProject(this.definition.id, (change) => {
      if (change.type === 'project_changed' && change.revision !== this.definition.revision) void this.pull();
      if (change.type === 'project_removed') log.warn(`[ProjectSync] Project "${change.id}" was removed from the Project Server`);
    }, {
      onState: (connected) => {
        this.streaming = connected;
        // Anything saved while the stream was down was never announced.
        if (connected) void this.pull();
      },
    });
    this.poller = setInterval(() => {
      if (!this.streaming || Date.now() - this.lastPull >= slowPollMs) void this.pull();
    }, pollMs);
    this.poller.unref?.();
  }

  /** Queue a write of the current team and header fields. */
  schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, DEBOUNCE_MS);
    this.timer.unref?.();
  }

  /** Write immediately, waiting for any in-progress write first. */
  async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    return this.queue(() => this.write());
  }

  /** Apply a newer revision from the Project Server, if there is one. */
  async pull(): Promise<void> {
    return this.queue(async () => {
      this.lastPull = Date.now();
      const latest = await this.client.getProject(this.definition.id).catch(() => undefined);
      if (latest && latest.revision !== this.definition.revision) await this.adopt(latest);
    });
  }

  /** Apply the definition held now to the live team, whatever its revision. */
  async applyNow(): Promise<void> {
    return this.queue(() => this.adopt(this.definition));
  }

  stop(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.poller) { clearInterval(this.poller); this.poller = null; }
    this.watch?.stop();
    this.watch = null;
    this.streaming = false;
  }

  /** One read or write at a time, so a pull never lands in the middle of a write. */
  private queue(step: () => Promise<void>): Promise<void> {
    this.inFlight = this.inFlight.then(step).catch((err: Error) =>
      log.warn(`[ProjectSync] ${err.message}`));
    return this.inFlight;
  }

  private async adopt(definition: ProjectDefinition): Promise<void> {
    const previous = this.definition.team;
    this.definition = definition;
    await this.apply(definition, previous);
  }

  private nextFields() {
    const orch = this.getOrchestrator();
    return {
      // Members disabled in the Designer, or away on a visit, are not running
      // here, but stay on the team.
      team: [
        ...liveTeam(orch, this.definition.team),
        ...this.definition.team.filter((a) => a.enabled === false || a.away),
      ],
      goal: orch.getProjectGoal() ?? '',
      humanName: orch.getHumanName(),
    };
  }

  private async write(): Promise<void> {
    try {
      const updated = await this.client.replaceProject(this.definition.id, this.nextFields(), this.definition.revision);
      if (updated) { this.definition = updated; return; }
      log.warn(`[ProjectSync] Project "${this.definition.id}" no longer exists on the Project Server`);
    } catch (err) {
      // A 409 means the Designer edited the project underneath us. Apply its
      // edit to the live team first, then write the result once against the
      // newer revision, rather than forcing our older version over it.
      const status = (err as { status?: number }).status;
      if (status === 409) {
        const latest = await this.client.getProject(this.definition.id).catch(() => undefined);
        if (latest) {
          await this.adopt(latest);
          const retried = await this.client
            .replaceProject(this.definition.id, this.nextFields(), latest.revision)
            .catch(() => undefined);
          if (retried) { this.definition = retried; return; }
        }
      }
      log.warn(`[ProjectSync] Could not save the project definition: ${(err as Error).message}`);
    }
  }
}
