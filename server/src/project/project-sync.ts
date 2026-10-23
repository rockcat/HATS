/**
 * Writing runtime changes back to the Project Server.
 *
 * The team can change itself while it runs — agents get added, renamed, retired,
 * the goal gets edited. Those changes belong in the project definition, not only
 * in the runner's local snapshot, so the Designer sees them and the next start
 * reproduces the same team.
 *
 * Writes are debounced and best-effort: the Project Server being down must never
 * stop a running team.
 */

import type { ProjectServerClient } from '../../../packages/clients/src/project-server-client.js';
import type { DeployedAgent, ProjectDefinition } from '../../../packages/contracts/src/types.js';
import type { TeamOrchestrator } from '../orchestrator/orchestrator.js';
import { toDeployedAgent } from '../embodiment/agent-mapper.js';
import { log } from '../../../packages/core/src/logger.js';

const DEBOUNCE_MS = 2_000;

export class ProjectSync {
  private readonly client: ProjectServerClient;
  private readonly getOrchestrator: () => TeamOrchestrator;
  private definition: ProjectDefinition;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> = Promise.resolve();

  constructor(client: ProjectServerClient, definition: ProjectDefinition, getOrchestrator: () => TeamOrchestrator) {
    this.client = client;
    this.definition = definition;
    this.getOrchestrator = getOrchestrator;
  }

  get projectId(): string { return this.definition.id; }
  get current(): ProjectDefinition { return this.definition; }

  /** Queue a write of the current team and header fields. */
  schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, DEBOUNCE_MS);
    this.timer.unref?.();
  }

  /** Write immediately, waiting for any in-progress write first. */
  async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.inFlight = this.inFlight.then(() => this.write()).catch(() => {});
    return this.inFlight;
  }

  stop(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  /** Snapshot the live team as deployed-agent documents, preserving template links. */
  private buildTeam(): DeployedAgent[] {
    const previous = new Map(this.definition.team.map((a) => [a.instanceId, a]));
    return this.getOrchestrator().listAgents().map((agent) => toDeployedAgent(agent, previous.get(agent.id)));
  }

  private async write(): Promise<void> {
    const orch = this.getOrchestrator();
    const next = {
      team: this.buildTeam(),
      goal: orch.getProjectGoal() ?? '',
      humanName: orch.getHumanName(),
    };

    try {
      const updated = await this.client.replaceProject(this.definition.id, next, this.definition.revision);
      if (updated) { this.definition = updated; return; }
      log.warn(`[ProjectSync] Project "${this.definition.id}" no longer exists on the Project Server`);
    } catch (err) {
      // A 409 means the Designer edited the project underneath us. Re-read and
      // retry once against the newer revision rather than forcing our version.
      const status = (err as { status?: number }).status;
      if (status === 409) {
        const latest = await this.client.getProject(this.definition.id).catch(() => undefined);
        if (latest) {
          this.definition = latest;
          const retried = await this.client
            .replaceProject(this.definition.id, next, latest.revision)
            .catch(() => undefined);
          if (retried) { this.definition = retried; return; }
        }
      }
      log.warn(`[ProjectSync] Could not save the project definition: ${(err as Error).message}`);
    }
  }
}
