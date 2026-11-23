/**
 * Visits: an agent going to another team to do a piece of its home team's
 * work, and coming back with the result. See docs/team-visits.md.
 *
 * The Project Server coordinates, because it holds both teams' projects:
 * leaving home and coming home are each one change to both. Runners do the
 * rest (letting the agent finish its turn, packing it, embodying it at the
 * other end) and follow the projects through the change stream, which also
 * announces every step of a visit to both teams.
 */

import { randomUUID } from 'crypto';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import * as path from 'path';
import { JsonStore } from '@hats/service-kit/json-store';
import {
  advance, comeHome, isOpen, leaveHome, visitDeadline, visitProblem, VisitRuleError,
} from '@hats/contracts/visit-record';
import type { Visit, VisitEnd, VisitReason, VisitResult, VisitState } from '@hats/contracts/types';
import type { ProjectStore } from '../project-store.js';

export type PackDirection = 'out' | 'back';

export interface VisitRequest {
  agent: string;
  home: string;
  host: string;
  reason: VisitReason;
}

export class VisitService {
  private readonly visits: JsonStore<Visit>;
  private readonly packsDir: string;

  constructor(
    private readonly projects: ProjectStore,
    dir: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.visits = new JsonStore<Visit>({ dir, keyOf: (v) => v.id });
    this.packsDir = path.join(dir, 'packs');
  }

  async load(): Promise<void> {
    await this.visits.load();
    await mkdir(this.packsDir, { recursive: true });
  }

  get(id: string): Visit | undefined { return this.visits.get(id); }

  /** Visits involving `project`, as home or host, newest first; only unfinished ones if `open`. */
  list(project?: string, open = false): Visit[] {
    const p = project?.toLowerCase();
    return this.visits.list()
      .filter((v) => !p || v.home.toLowerCase() === p || v.host.toLowerCase() === p)
      .filter((v) => !open || isOpen(v))
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  }

  async request(req: VisitRequest): Promise<Visit> {
    const home = this.project(req.home);
    const host = this.project(req.host);
    const problem = visitProblem(home, host, req.agent, req.reason, this.list(home.id, true));
    if (problem) throw new VisitRuleError(409, problem);

    const agent = home.team.find((a) => a.instanceId === req.agent)!;
    const at = this.now().toISOString();
    const policy = host.settings?.visits;
    let visit: Visit = {
      id: randomUUID(),
      agent: { instanceId: agent.instanceId, name: agent.name },
      home: home.id,
      host: host.id,
      reason: req.reason,
      state: 'requested',
      approval: policy?.approval ?? 'admin',
      memoryHome: policy?.memoryHome ?? 'summary',
      requestedAt: at,
      updatedAt: at,
      history: [{ state: 'requested', at }],
    };
    if (visit.approval === 'auto') visit = advance(visit, 'approved', at, `${host.name} hosts visitors from ${home.name} without asking`);
    return this.save(visit);
  }

  approve(id: string, note?: string): Promise<Visit> { return this.step(id, 'approved', note); }
  refuse(id: string, note?: string): Promise<Visit> { return this.step(id, 'refused', note); }
  cancel(id: string, note?: string): Promise<Visit> { return this.step(id, 'cancelled', note); }

  /**
   * The agent has left home with `pack`: in one change, home keeps its place,
   * marked away, and the host takes it as a visitor. The policy is checked
   * again, since either team may have changed it since the request.
   */
  async leave(id: string, pack: unknown): Promise<Visit> {
    const visit = this.visit(id);
    if (visit.state !== 'approved') throw new VisitRuleError(409, `A visit that is ${visit.state} cannot leave.`);
    const home = this.project(visit.home);
    const host = this.project(visit.host);
    const problem = visitProblem(home, host, visit.agent.instanceId, visit.reason,
      this.list(home.id, true).filter((v) => v.id !== id));
    if (problem) throw new VisitRuleError(409, problem);

    await this.writePack(id, 'out', pack);
    const teams = leaveHome(home, host, visit);
    await this.projects.update(home.id, { team: teams.home });
    await this.projects.update(host.id, { team: teams.host });

    const leftAt = this.now();
    const endsBy = visitDeadline(home, host, leftAt);
    return this.save({ ...advance(visit, 'visiting', leftAt.toISOString()), ...(endsBy && { endsBy }) });
  }

  /**
   * The visit is over: the host has let the agent finish, and sends its result
   * and what it takes home. In one change the host no longer has it and home
   * has it in its place again; home's runner takes it from there.
   */
  async return(id: string, result: VisitResult, ended: { by: VisitEnd; note?: string }, pack?: unknown): Promise<Visit> {
    const visit = this.visit(id);
    if (visit.state !== 'visiting') throw new VisitRuleError(409, `A visit that is ${visit.state} cannot return.`);
    if (pack !== undefined) await this.writePack(id, 'back', pack);
    const home = this.project(visit.home);
    const host = this.project(visit.host);
    const teams = comeHome(home, host, visit);
    await this.projects.update(host.id, { team: teams.host });
    await this.projects.update(home.id, { team: teams.home });
    return this.save({ ...advance(visit, 'returning', this.now().toISOString(), ended.note), result, ended });
  }

  /**
   * Home wants its agent back: an admin recalled it, or the ticket it went
   * for is closed. The host is told, and sends it home with what it has.
   */
  async recall(id: string, by: 'recalled' | 'reason-gone', note?: string): Promise<Visit> {
    const visit = this.visit(id);
    if (visit.state !== 'visiting') throw new VisitRuleError(409, `A visit that is ${visit.state} cannot be recalled.`);
    return this.save({ ...visit, recall: { by, at: this.now().toISOString(), ...(note && { note }) }, updatedAt: this.now().toISOString() });
  }

  /** Home has the agent running again with its result: the packs are no longer needed. */
  async home(id: string): Promise<Visit> {
    const visit = await this.step(id, 'home');
    await Promise.all((['out', 'back'] as const).map((d) => rm(this.packFile(id, d), { force: true })));
    return visit;
  }

  async readPack(id: string, direction: PackDirection): Promise<unknown | undefined> {
    this.visit(id);
    try { return JSON.parse(await readFile(this.packFile(id, direction), 'utf8')); } catch { return undefined; }
  }

  private async step(id: string, to: VisitState, note?: string): Promise<Visit> {
    return this.save(advance(this.visit(id), to, this.now().toISOString(), note));
  }

  private async save(visit: Visit): Promise<Visit> {
    const saved = await this.visits.put(visit);
    this.projects.announce({ type: 'visit_changed', id: saved.id, home: saved.home, host: saved.host, state: saved.state });
    return saved;
  }

  private visit(id: string): Visit {
    const visit = this.visits.get(id);
    if (!visit) throw new VisitRuleError(404, `There is no visit ${id}.`);
    return visit;
  }

  private project(id: string) {
    const project = this.projects.get(id);
    if (!project) throw new VisitRuleError(404, `There is no project ${id}.`);
    return project;
  }

  private packFile(id: string, direction: PackDirection): string {
    return path.join(this.packsDir, `${id}.${direction}.json`);
  }

  private async writePack(id: string, direction: PackDirection, pack: unknown): Promise<void> {
    await writeFile(this.packFile(id, direction), JSON.stringify(pack ?? {}), 'utf8');
  }
}
