/** Server-sent event fan-out with per-client filtering. */

import type { ServerResponse } from 'http';

const HEARTBEAT_MS = 25_000;

interface Client<F> {
  res: ServerResponse;
  filter: F | null;
}

export class SseHub<E extends { type: string }, F = unknown> {
  private clients: Client<F>[] = [];
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private readonly accepts: (event: E, filter: F) => boolean;

  /** `accepts` decides whether a filtered client should receive an event. */
  constructor(accepts: (event: E, filter: F) => boolean = () => true) {
    this.accepts = accepts;
  }

  get clientCount(): number { return this.clients.length; }

  /** Attach a response as an event stream. Optionally send an opening frame. */
  subscribe(res: ServerResponse, filter: F | null = null, hello?: E): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(': connected\n\n');
    const client: Client<F> = { res, filter };
    this.clients.push(client);
    if (hello) this.writeTo(client, hello);

    const drop = () => { this.clients = this.clients.filter((c) => c !== client); this.maybeStopHeartbeat(); };
    res.on('close', drop);
    res.on('error', drop);
    this.startHeartbeat();
  }

  broadcast(event: E): void {
    for (const client of [...this.clients]) this.writeTo(client, event);
  }

  close(): void {
    for (const client of this.clients) { try { client.res.end(); } catch { /* already gone */ } }
    this.clients = [];
    this.maybeStopHeartbeat();
  }

  private writeTo(client: Client<F>, event: E): void {
    if (client.filter !== null && !this.accepts(event, client.filter)) return;
    try {
      client.res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    } catch {
      this.clients = this.clients.filter((c) => c !== client);
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => {
      for (const client of [...this.clients]) {
        try { client.res.write(`event: heartbeat\ndata: {"type":"heartbeat"}\n\n`); }
        catch { this.clients = this.clients.filter((c) => c !== client); }
      }
    }, HEARTBEAT_MS);
    this.heartbeat.unref?.();
  }

  private maybeStopHeartbeat(): void {
    if (this.clients.length === 0 && this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }
}
