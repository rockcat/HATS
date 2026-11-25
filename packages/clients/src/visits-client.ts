/** Typed client for the Project Server's visits. See docs/team-visits.md in the HATS repository. */

import { HttpClient } from './http-client.js';
import type { Move, Visit, VisitEnd, VisitReason, VisitResult } from '../../contracts/src/types.js';

const BASE = '/api/v1/visits';

/**
 * The HTTP client answers a 404 with undefined. For a call that must return
 * something, that is the Project Server saying "no such thing": say so,
 * rather than hand back undefined dressed as a visit.
 */
function found<T>(value: T | undefined, missing: string): T {
  if (value === undefined) throw new Error(missing);
  return value;
}

export class VisitsClient {
  private readonly http: HttpClient;

  /**
   * A travel pack can be a few megabytes, so this allows longer than most
   * calls. `headers` carries the installation's runner token, which visits need.
   */
  constructor(baseUrl: string, timeoutMs = 60_000, headers: Record<string, string> = {}) {
    this.http = new HttpClient({ service: 'Project Server', baseUrl, timeoutMs, headers });
  }

  /** Ask for a visit. Throws with the reason when it may not happen. */
  async request(req: { agent: string; home: string; host: string; reason: VisitReason }): Promise<Visit> {
    return found(await this.http.post<Visit>(BASE, req),
      `There is no team "${req.host}", or no agent ${req.agent} at ${req.home}, on the Project Server.`);
  }

  get(id: string): Promise<Visit | undefined> {
    return this.http.get<Visit>(`${BASE}/${encodeURIComponent(id)}`);
  }

  async list(project: string, open = false): Promise<Visit[]> {
    const query = new URLSearchParams({ project, ...(open && { open: 'true' }) });
    return (await this.http.get<{ visits: Visit[] }>(`${BASE}?${query}`))?.visits ?? [];
  }

  approve(id: string, note?: string) { return this.step(id, 'approve', { note }); }
  refuse(id: string, note?: string) { return this.step(id, 'refuse', { note }); }
  cancel(id: string, note?: string) { return this.step(id, 'cancel', { note }); }

  /** The agent has left home with its travel pack. */
  leave(id: string, pack: unknown) { return this.step(id, 'leave', { pack }); }

  /** The agent has left the host with its result, and what it takes home. */
  return(id: string, result: VisitResult, ended: { by: VisitEnd; note?: string }, pack?: unknown) {
    return this.step(id, 'return', { result, ended, ...(pack !== undefined && { pack }) });
  }

  /** Home has the agent running again. */
  home(id: string) { return this.step(id, 'home', {}); }

  /** Home wants the agent back; the host sends it. */
  recall(id: string, by: 'recalled' | 'reason-gone', note?: string) { return this.step(id, 'recall', { by, note }); }

  // ── Permanent moves ────────────────────────────────────────────────────────

  /** Move an agent to another team for good, with its pack. Throws with the reason when it may not. */
  async move(req: { agent: string; from: string; to: string; note?: string; pack: unknown }): Promise<Move> {
    return found(await this.http.post<Move>('/api/v1/moves', req),
      `There is no team "${req.to}", or no agent ${req.agent} at ${req.from}, on the Project Server.`);
  }

  movePack(id: string): Promise<unknown | undefined> {
    return this.http.get<unknown>(`/api/v1/moves/${encodeURIComponent(id)}/pack`);
  }

  /** The new team's runner has the agent running. */
  async moveDone(id: string): Promise<Move> {
    return found(await this.http.post<Move>(`/api/v1/moves/${encodeURIComponent(id)}/done`, {}), `There is no move ${id}.`);
  }

  /** Every project, to choose where an agent goes. */
  async projects(): Promise<Array<{ id: string; name: string }>> {
    return (await this.http.get<{ projects: Array<{ id: string; name: string }> }>('/api/v1/projects'))?.projects ?? [];
  }

  /** A travel pack, or undefined when there is none. */
  pack(id: string, direction: 'out' | 'back'): Promise<unknown | undefined> {
    return this.http.get<unknown>(`${BASE}/${encodeURIComponent(id)}/pack/${direction}`);
  }

  private async step(id: string, step: string, body: unknown): Promise<Visit> {
    return found(await this.http.post<Visit>(`${BASE}/${encodeURIComponent(id)}/${step}`, body), `There is no visit ${id}.`);
  }
}
