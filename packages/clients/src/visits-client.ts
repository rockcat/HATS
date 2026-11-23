/** Typed client for the Project Server's visits. See docs/team-visits.md in the HATS repository. */

import { HttpClient } from './http-client.js';
import type { Visit, VisitEnd, VisitReason, VisitResult } from '../../contracts/src/types.js';

const BASE = '/api/v1/visits';

export class VisitsClient {
  private readonly http: HttpClient;

  /** A travel pack can be a few megabytes, so this allows longer than most calls. */
  constructor(baseUrl: string, timeoutMs = 60_000) {
    this.http = new HttpClient({ service: 'Project Server', baseUrl, timeoutMs });
  }

  /** Ask for a visit. Throws with the reason when it may not happen. */
  async request(req: { agent: string; home: string; host: string; reason: VisitReason }): Promise<Visit> {
    return (await this.http.post<Visit>(BASE, req))!;
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

  /** A travel pack, or undefined when there is none. */
  pack(id: string, direction: 'out' | 'back'): Promise<unknown | undefined> {
    return this.http.get<unknown>(`${BASE}/${encodeURIComponent(id)}/pack/${direction}`);
  }

  private async step(id: string, step: string, body: unknown): Promise<Visit> {
    return (await this.http.post<Visit>(`${BASE}/${encodeURIComponent(id)}/${step}`, body))!;
  }
}
