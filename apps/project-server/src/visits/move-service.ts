/**
 * Permanent moves: an admin sending an agent to another team for good, with
 * its conversations, memory and schedule. See docs/team-visits.md.
 *
 * The old team's runner packs the agent and asks here; in one change it
 * leaves the old team and joins the new one, marked with the move until the
 * new team's runner has it running and says so.
 */

import { randomUUID } from 'crypto';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import * as path from 'path';
import { JsonStore } from '@hats/service-kit/json-store';
import { moveProblem, moveTeams, VisitRuleError } from '@hats/contracts/visit-record';
import type { Move } from '@hats/contracts/types';
import type { ProjectStore } from '../project-store.js';
import type { VisitService } from './visit-service.js';

export interface MoveRequest {
  agent: string;
  from: string;
  to: string;
  note?: string;
  pack: unknown;
}

export class MoveService {
  private readonly moves: JsonStore<Move>;
  private readonly packsDir: string;

  constructor(
    private readonly projects: ProjectStore,
    private readonly visits: VisitService,
    dir: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.moves = new JsonStore<Move>({ dir, keyOf: (m) => m.id });
    this.packsDir = path.join(dir, 'packs');
  }

  async load(): Promise<void> {
    await this.moves.load();
    await mkdir(this.packsDir, { recursive: true });
  }

  get(id: string): Move | undefined { return this.moves.get(id); }

  async move(req: MoveRequest): Promise<Move> {
    const from = this.project(req.from);
    const to = this.project(req.to);
    const problem = moveProblem(from, to, req.agent, this.visits.list(from.id, true));
    if (problem) throw new VisitRuleError(409, problem);

    const agent = from.team.find((a) => a.instanceId === req.agent)!;
    const at = this.now().toISOString();
    const move: Move = {
      id: randomUUID(),
      agent: { instanceId: agent.instanceId, name: agent.name },
      from: from.id,
      to: to.id,
      state: 'moving',
      ...(req.note && { note: req.note }),
      requestedAt: at,
      updatedAt: at,
    };
    await writeFile(this.packFile(move.id), JSON.stringify(req.pack ?? {}), 'utf8');
    const teams = moveTeams(from, to, move.id, req.agent);
    // Joining first: if the second write failed, the agent would be on both
    // teams, which its new runner can sort out, rather than on neither.
    await this.projects.update(to.id, { team: teams.to });
    await this.projects.update(from.id, { team: teams.from });
    return this.moves.put(move);
  }

  /** The new team's runner has the agent running: the pack and the marker go. */
  async done(id: string): Promise<Move> {
    const move = this.moves.get(id);
    if (!move) throw new VisitRuleError(404, `There is no move ${id}.`);
    if (move.state === 'done') return move;
    const to = this.project(move.to);
    await this.projects.update(to.id, {
      team: to.team.map((a) => {
        if (a.move !== id) return a;
        const arrived = { ...a };
        delete arrived.move;
        return arrived;
      }),
    });
    await rm(this.packFile(id), { force: true });
    return this.moves.put({ ...move, state: 'done', updatedAt: this.now().toISOString() });
  }

  async readPack(id: string): Promise<unknown | undefined> {
    if (!this.moves.get(id)) throw new VisitRuleError(404, `There is no move ${id}.`);
    try { return JSON.parse(await readFile(this.packFile(id), 'utf8')); } catch { return undefined; }
  }

  private project(id: string) {
    const project = this.projects.get(id);
    if (!project) throw new VisitRuleError(404, `There is no project ${id}.`);
    return project;
  }

  private packFile(id: string): string { return path.join(this.packsDir, `${id}.json`); }
}
