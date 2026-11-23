/**
 * A runner's part in visits: see docs/team-visits.md in the HATS repository.
 *
 * At home: an agent asks to visit; once the host agrees and its turn ends,
 * it leaves with a travel pack, and its place is kept here: its tickets, its
 * schedule, its conversations and logins, saved to a file on this machine.
 * When it comes back it is restored from that place, with what it learned
 * added, and its result goes on the ticket the visit was for.
 *
 * At a host: a visitor arrives from its pack with a ticket of its own here
 * and the reason as its task, and goes home with its result when it calls
 * finish_visit.
 *
 * The Project Server moves the agent between the two teams; each runner
 * follows through the team sync, which hands the steps here.
 */

import { existsSync } from 'fs';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import * as path from 'path';
import type { VisitsClient } from '../../../packages/clients/src/visits-client.js';
import type { DeployedAgent, Move, ProjectChange, ProjectDefinition, Visit, VisitEnd, VisitResult } from '../../../packages/contracts/src/types.js';
import { log } from '../../../packages/core/src/logger.js';
import type { IAgent } from '../agent/iagent.js';
import type { TeamOrchestrator, VisitTools } from '../orchestrator/orchestrator.js';
import { packAgent, unpackAgent } from '../agent-transfer/agent-bundle.js';
import { restoreAgent } from '../agent-transfer/agent-transfer.js';
import { captureFrom, targetFor, type AgentIo } from '../agent-transfer/agent-io.js';
import { MEMORY_FILE, mergeMemory, movingPack, openPack, outgoingPack, returningPack } from './travel-pack.js';

export interface CoordinatorDeps {
  client: VisitsClient;
  /** This runner's project, and its definition as last read. */
  definition: () => ProjectDefinition;
  io: () => AgentIo;
  /** Where the places of agents away from here are kept. */
  placeDir: string;
  /** The dashboard: the team or the board changed, or news to show. */
  teamChanged?: () => void;
  boardChanged?: () => void;
  tell?: (news: string[]) => void;
  /** How long an agent's turn may take to end before it leaves anyway. */
  idleTimeoutMs?: number;
}

const OUTCOMES = ['done', 'partial', 'failed'] as const;
/** How often recalls, deadlines and reasons are checked by the clock. */
const CLOCK_MS = 60_000;
/** How long past its deadline a visit may stay open before home takes its agent back. */
const HOST_GRACE_MS = 15 * 60_000;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const visitTag = (id: string) => `visit:${id}`;

/** Wait until `agent` is between turns, or the time is up. */
async function idle(agent: IAgent, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (agent.busy && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
}

/** A result in words, for the ticket the visit was for and for the agent. */
export function describeResult(visit: Pick<Visit, 'host' | 'result' | 'ended'>): string {
  const r = visit.result;
  if (!r) return `The visit to ${visit.host} ended without a result.`;
  return [
    `Result of the visit to ${visit.host} (${r.outcome}): ${r.summary}`,
    r.remaining && `Still to do: ${r.remaining}`,
    r.reason && `Why: ${r.reason}`,
    visit.ended && visit.ended.by !== 'finished' && `The visit ended early: ${visit.ended.by}${visit.ended.note ? `, ${visit.ended.note}` : ''}.`,
  ].filter(Boolean).join('\n');
}

export class VisitCoordinator implements VisitTools {
  /** Visits whose agent is on its way, so a repeated notice does not send it twice. */
  private readonly moving = new Set<string>();
  /** Results given by visitors here, waiting for their turn to end. */
  private readonly results = new Map<string, VisitResult>();

  constructor(private readonly d: CoordinatorDeps) {}

  private get orch(): TeamOrchestrator { return this.d.io().orchestrator; }
  private get project(): string { return this.d.definition().id; }
  private placeFile(visitId: string): string { return path.join(this.d.placeDir, `${visitId}.zip`); }

  private memberNamed(name: string): DeployedAgent | undefined {
    return this.d.definition().team.find((a) => same(a.name, name));
  }

  isVisitor(agentName: string): boolean { return Boolean(this.memberNamed(agentName)?.visit); }

  // ── At home ─────────────────────────────────────────────────────────────────

  /** request_visit: ask the Project Server, which checks both teams agree. */
  async request(agentName: string, args: Record<string, unknown>): Promise<string> {
    const agent = this.orch.getAgent(agentName);
    if (!agent) return 'You are not on this team.';
    const ticketId = String(args['ticket'] ?? '').trim();
    const board = await this.orch.readyBoard();
    const ticket = ticketId && board ? await board.getTicket(ticketId) : undefined;
    if (!ticket) return `There is no ticket ${ticketId || '(none given)'} on this board: a visit is for one of your tickets.`;
    if (ticket.column === 'closed') return `${ticketId} is closed, so there is nothing to visit for.`;

    const visit = await this.d.client.request({
      agent: agent.id, home: this.project, host: String(args['team'] ?? '').trim(),
      reason: { ticket: ticketId, purpose: String(args['purpose'] ?? ''), expectedResult: String(args['expected_result'] ?? '') },
    });
    await board!.addComment(ticketId, agent.name, `Asked to visit ${visit.host}: ${visit.reason.purpose}`).catch(() => {});
    this.d.boardChanged?.();
    return visit.state === 'approved'
      ? `${visit.host} has agreed. You leave for it when this turn ends: finish what you are saying, and do not start anything new.`
      : `Asked ${visit.host}; one of its admins has to agree. Carry on with your other work meanwhile: you will be told.`;
  }

  /** The Project Server's notices about visits involving this team. */
  onVisitChanged(change: Extract<ProjectChange, { type: 'visit_changed' }>): void {
    const home = same(change.home, this.project);
    const host = same(change.host, this.project);
    if (home && change.state === 'approved') void this.depart(change.id);
    if (home && change.state === 'refused') void this.refused(change.id);
    if (host && change.state === 'requested') void this.asked(change.id);
    // A visit still visiting that moved on has been recalled.
    if (host && change.state === 'visiting') void this.checkRecall(change.id);
  }

  /**
   * Everything that is due by the clock, or was missed while this runner was
   * not listening: an approved visit still to leave, a recall, a visit out of
   * time, a reason gone, a host that stopped.
   */
  async catchUp(): Promise<void> {
    const now = Date.now();
    for (const visit of await this.d.client.list(this.project, true).catch(() => [] as Visit[])) {
      const ends = visit.endsBy ? Date.parse(visit.endsBy) : Infinity;
      if (same(visit.home, this.project)) {
        if (visit.state === 'approved') void this.depart(visit.id);
        if (visit.state === 'visiting') await this.watchFromHome(visit, now, ends);
      } else if (visit.state === 'visiting') {
        if (visit.recall) void this.sendHome(visit.id, { by: visit.recall.by, ...(visit.recall.note && { note: visit.recall.note }) });
        else if (now >= ends) void this.sendHome(visit.id, { by: 'time', note: 'its time ran out' });
      }
    }
  }

  /** Check by the clock every `everyMs` until stopped. */
  startClock(everyMs = CLOCK_MS): () => void {
    const timer = setInterval(() => { void this.catchUp(); }, everyMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  /**
   * From home: recall an agent whose ticket was closed or given to someone
   * else, and take back one whose host has gone quiet well past its time.
   */
  private async watchFromHome(visit: Visit, now: number, ends: number): Promise<void> {
    if (now >= ends + HOST_GRACE_MS) {
      await this.d.client.return(visit.id,
        { outcome: 'failed', summary: 'The visit did not end in time, and the host team did not send the agent home.', reason: 'the host team stopped' },
        { by: 'host-stopped' }).catch(() => {});
      return;
    }
    if (visit.recall) return;
    const board = await this.orch.readyBoard();
    const ticket = board ? await board.getTicket(visit.reason.ticket) : undefined;
    const gone = !ticket ? 'it no longer exists'
      : ticket.column === 'closed' ? 'it was closed'
      : ticket.assignee && !same(ticket.assignee, visit.agent.name) ? `it was given to ${ticket.assignee}` : null;
    if (gone) await this.d.client.recall(visit.id, 'reason-gone', `${visit.reason.ticket}: ${gone}`).catch(() => {});
  }

  private async checkRecall(id: string): Promise<void> {
    const visit = await this.d.client.get(id);
    if (visit?.state === 'visiting' && visit.recall) {
      await this.sendHome(id, { by: visit.recall.by, ...(visit.recall.note && { note: visit.recall.note }) });
    }
  }

  // ── For the dashboard ───────────────────────────────────────────────────────

  /** Unfinished visits involving this team. */
  list(): Promise<Visit[]> { return this.d.client.list(this.project, true); }

  /** At a host: agree to a visit, or not. */
  async decide(id: string, approve: boolean, note?: string): Promise<Visit> {
    const visit = await this.ours(id, 'host');
    return approve ? this.d.client.approve(visit.id, note) : this.d.client.refuse(visit.id, note);
  }

  /** At home: ask for an agent back, or call off a visit that has not started. */
  async recall(id: string, note?: string): Promise<Visit> {
    const visit = await this.ours(id, 'home');
    return visit.state === 'visiting' ? this.d.client.recall(id, 'recalled', note) : this.d.client.cancel(id, note);
  }

  /** At a host: send a visitor home now, with whatever it has. */
  async end(id: string, note?: string): Promise<void> {
    await this.ours(id, 'host');
    await this.sendHome(id, { by: 'ended-by-host', ...(note && { note }) });
  }

  private async ours(id: string, side: 'home' | 'host'): Promise<Visit> {
    const visit = await this.d.client.get(id);
    if (!visit || !same(visit[side], this.project)) throw new Error(`There is no such visit ${side === 'home' ? 'from' : 'to'} this team.`);
    return visit;
  }

  private async asked(id: string): Promise<void> {
    const visit = await this.d.client.get(id);
    if (!visit) return;
    this.d.tell?.([`${visit.agent.name} from ${visit.home} asks to visit, to ${visit.reason.purpose}. `
      + 'Approve or refuse it in the project list.']);
  }

  private async refused(id: string): Promise<void> {
    const visit = await this.d.client.get(id);
    if (!visit) return;
    const note = visit.history.at(-1)?.note;
    const text = `${visit.host} did not agree to your visit${note ? `: ${note}` : '.'} Carry on without it, or ask the human.`;
    this.orch.getAgent(visit.agent.name)?.notice(text);
    const board = await this.orch.readyBoard();
    await board?.addComment(visit.reason.ticket, 'visits', `${visit.host} refused the visit${note ? `: ${note}` : '.'}`).catch(() => {});
    this.d.boardChanged?.();
  }

  /**
   * The host agreed: let the agent finish its turn, keep its place here, and
   * leave with its travel pack. If leaving fails it stays, and is told.
   */
  async depart(id: string): Promise<void> {
    if (this.moving.has(id)) return;
    this.moving.add(id);
    try {
      const visit = await this.d.client.get(id);
      if (!visit || visit.state !== 'approved') return;
      const agent = this.orch.listAgents().find((a) => a.id === visit.agent.instanceId);
      if (!agent) { await this.d.client.cancel(id, `${visit.agent.name} is not running at home`); return; }

      await idle(agent, this.d.idleTimeoutMs ?? 60_000);
      await mkdir(this.d.placeDir, { recursive: true });
      // The place kept here has everything, logins included: it never leaves this machine.
      await writeFile(this.placeFile(id), await packAgent(await captureFrom(this.d.io(), agent, true)));
      const pack = await outgoingPack(await captureFrom(this.d.io(), agent, false));
      try {
        await this.d.client.leave(id, pack);
      } catch (err) {
        await rm(this.placeFile(id), { force: true });
        await this.d.client.cancel(id, `could not leave: ${(err as Error).message}`).catch(() => {});
        agent.notice(`Your visit to ${visit.host} could not start: ${(err as Error).message}`);
        return;
      }
      const board = await this.orch.readyBoard();
      await board?.addComment(visit.reason.ticket, agent.name, `Gone to visit ${visit.host}: ${visit.reason.purpose}`).catch(() => {});
      this.d.boardChanged?.();
    } catch (err) {
      log.warn(`[Visits] Visit ${id} could not leave: ${(err as Error).message}`);
    } finally {
      this.moving.delete(id);
    }
  }

  /** The team sync: an agent here is now away. Its place was kept as it left. */
  async leaving(member: DeployedAgent): Promise<void> {
    if (this.orch.getAgent(member.name)) this.orch.setAside(member.name);
    else this.orch.markAway([member.name]);
    this.d.teamChanged?.();
  }

  /** The team sync: an agent of ours is back. Restore it from its place, with what it learned. */
  async returning(member: DeployedAgent): Promise<void> {
    const id = member.away?.visit;
    if (!id) return;
    const placeFile = this.placeFile(id);
    if (!existsSync(placeFile)) {
      log.warn(`[Visits] ${member.name} is back, but its place was not kept here; it starts from its settings`);
      throw new Error('its place was not kept on this runner');
    }
    const bundle = await unpackAgent(new Uint8Array(await readFile(placeFile)));
    const back = await this.d.client.pack(id, 'back');
    if (back !== undefined) {
      const learned = (await openPack(back)).files.get(MEMORY_FILE);
      const memory = mergeMemory(bundle.files.get(MEMORY_FILE), learned);
      if (memory) bundle.files.set(MEMORY_FILE, memory);
    }

    this.orch.welcomeBack(member.name);
    await restoreAgent(targetFor(this.d.io()), bundle, { name: member.name, keepId: true });

    const visit = await this.d.client.get(id);
    if (visit) {
      const result = describeResult(visit);
      const board = await this.orch.readyBoard();
      await board?.addComment(visit.reason.ticket, member.name, result).catch(() => {});
      this.d.boardChanged?.();
      await this.orch.humanAssignTask(member.name,
        `You are back from your visit to ${visit.host}. ${result}\n\nCarry on with ${visit.reason.ticket} with what you found.`,
        undefined, undefined, visit.reason.ticket);
    }
    await this.d.client.home(id).catch((err: Error) => log.warn(`[Visits] Visit ${id}: ${err.message}`));
    await rm(placeFile, { force: true });
    this.d.teamChanged?.();
  }

  // ── At a host ───────────────────────────────────────────────────────────────

  /** The team sync: a visitor has arrived. Embody it from its pack, with a ticket here and its reason as its task. */
  async arriving(member: DeployedAgent): Promise<void> {
    const id = member.visit!;
    const [visit, pack] = await Promise.all([this.d.client.get(id), this.d.client.pack(id, 'out')]);
    if (!visit || pack === undefined) throw new Error(`visit ${id} or its travel pack is missing`);
    await restoreAgent(targetFor(this.d.io()), await openPack(pack), { name: member.name, keepId: true });

    const board = await this.orch.readyBoard();
    const ticket = await board?.createTicket({
      title: `Visit from ${visit.home}: ${visit.reason.purpose}`.slice(0, 120),
      description: `${member.name} is visiting from ${visit.home} for their ticket ${visit.reason.ticket}.\n\n`
        + `What they will do: ${visit.reason.purpose}\nWhat they will bring back: ${visit.reason.expectedResult}`,
      creator: 'visits', assignee: member.name, tags: [visitTag(id)],
    });
    if (ticket) await board!.moveTicket(ticket.id, 'in_progress').catch(() => {});
    this.d.boardChanged?.();
    this.d.teamChanged?.();

    await this.orch.humanAssignTask(member.name,
      `You are visiting ${this.d.definition().name} from your home team, ${visit.home}, for your ticket `
      + `${visit.reason.ticket} there.\n\nWhat you are here to do: ${visit.reason.purpose}\n`
      + `What to bring back: ${visit.reason.expectedResult}\n\n`
      + 'Use what this team has. Work only on this. When it is done, or cannot be done, call finish_visit '
      + 'with your result: a clear reason why it could not be done is a result too.',
      undefined, undefined, ticket?.id);
  }

  /** finish_visit: the visitor's result, sent home once its turn ends. */
  async finish(agentName: string, args: Record<string, unknown>): Promise<string> {
    const member = this.memberNamed(agentName);
    if (!member?.visit) return 'You are not on a visit, so there is nothing to finish.';
    const outcome = String(args['outcome'] ?? '') as VisitResult['outcome'];
    const summary = String(args['summary'] ?? '').trim();
    if (!OUTCOMES.includes(outcome) || !summary) return 'finish_visit needs an outcome (done, partial or failed) and a summary.';
    const optional = (key: string) => (typeof args[key] === 'string' && (args[key] as string).trim()) || undefined;
    const remaining = optional('remaining');
    const reason = optional('reason');
    this.results.set(member.visit, { outcome, summary, ...(remaining && { remaining }), ...(reason && { reason }) });
    void this.sendHome(member.visit, { by: 'finished' });
    return `Thank you. You go home to ${member.home} with this result when this turn ends: finish what you are saying.`;
  }

  /** Let the visitor's turn end, then send it home with its result and what the host lets it take. */
  async sendHome(id: string, ended: { by: VisitEnd; note?: string }): Promise<void> {
    if (this.moving.has(id)) return;
    this.moving.add(id);
    try {
      const visit = await this.d.client.get(id);
      if (!visit || visit.state !== 'visiting') return;
      const agent = this.orch.listAgents().find((a) => a.id === visit.agent.instanceId);
      const result = this.results.get(id)
        ?? { outcome: 'failed' as const, summary: 'The visit ended before a result was given.', reason: ended.by };
      let pack;
      if (agent) {
        await idle(agent, this.d.idleTimeoutMs ?? 60_000);
        pack = await returningPack(await captureFrom(this.d.io(), agent, false), visit.memoryHome);
      }
      await this.d.client.return(id, result, ended, pack);
      this.results.delete(id);
      await this.closeTicket(id, `${visit.agent.name} has gone home. ${describeResult({ ...visit, result, ended })}`);
    } catch (err) {
      log.warn(`[Visits] Visit ${id} could not go home: ${(err as Error).message}`);
    } finally {
      this.moving.delete(id);
    }
  }

  /** The team sync: a visitor has gone home. */
  async departing(member: DeployedAgent): Promise<void> {
    if (this.orch.getAgent(member.name)) await this.orch.removeAgent(member.name);
    this.d.teamChanged?.();
  }

  // ── Permanent moves ─────────────────────────────────────────────────────────

  /** The teams an agent here could be moved to: every other project. The Project Server says which take it. */
  async moveTargets(): Promise<Array<{ id: string; name: string }>> {
    return (await this.d.client.projects()).filter((p) => !same(p.id, this.project));
  }

  /**
   * An admin moves an agent to another team for good: its turn ends, and it
   * goes with everything but its logins. Its open tickets here go back to the
   * backlog when the team sync takes it off this team.
   */
  async moveOut(agentName: string, to: string, note?: string): Promise<Move> {
    const agent = this.orch.getAgent(agentName);
    if (!agent) throw new Error(`There is no agent called ${agentName} here.`);
    if (this.isVisitor(agentName)) throw new Error(`${agent.name} is visiting; its home team decides where it goes.`);
    await idle(agent, this.d.idleTimeoutMs ?? 60_000);
    const pack = await movingPack(await captureFrom(this.d.io(), agent, false));
    return this.d.client.move({ agent: agent.id, from: this.project, to, pack, ...(note && { note }) });
  }

  /** The team sync: an agent has moved here. Embody it from its pack, and say it has arrived. */
  async movingIn(member: DeployedAgent): Promise<void> {
    const id = member.move!;
    const pack = await this.d.client.movePack(id);
    if (pack === undefined) throw new Error(`move ${id} has no pack`);
    const agent = (await restoreAgent(targetFor(this.d.io()), await openPack(pack), { name: member.name, keepId: true }));
    await this.d.client.moveDone(id);
    this.orch.getAgent(agent.name)?.notice(`You have moved to ${this.d.definition().name} for good. `
      + 'Your conversations and schedule came with you; logins to your own accounts did not, and need setting up again here.');
    this.d.teamChanged?.();
  }

  private async closeTicket(visitId: string, note: string): Promise<void> {
    const board = await this.orch.readyBoard();
    if (!board) return;
    const ticket = (await board.listTickets()).find((t) => t.tags?.includes(visitTag(visitId)));
    if (!ticket || ticket.column === 'closed') return;
    await board.addComment(ticket.id, 'visits', note).catch(() => {});
    await board.moveTicket(ticket.id, 'closed', 'completed').catch(() => {});
    this.d.boardChanged?.();
  }
}
