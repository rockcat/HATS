// ── Reporting in to the runner manager ───────────────────────────────────────
//
// So the dashboard can list every runner and switch between them, each one
// tells the runner manager which project it holds and where its dashboard
// is, every HEARTBEAT_MS. Launched by the manager or written into a compose
// file by hand, every runner does the same. Missing a beat costs nothing: the
// manager shows the runner as unreachable until the next one arrives.

import { log } from '../../packages/core/src/logger.js';

export const HEARTBEAT_MS = 30_000;

export interface HeartbeatOptions {
  managerUrl: string;
  /** The project held now; a runner that is not locked can switch. */
  project: () => string;
  port: number;
  /** A better address for the dashboard than the browser's host + port. */
  url?: string;
  fetchImpl?: typeof fetch;
}

/** Report in now and on a timer. Returns a function that stops it. */
export function startHeartbeat(o: HeartbeatOptions): () => void {
  const target = `${o.managerUrl.replace(/\/$/, '')}/api/v1/runners/heartbeat`;
  const send = o.fetchImpl ?? fetch;
  let warned = false;

  const beat = async () => {
    try {
      const res = await send(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: o.project(), port: o.port, ...(o.url && { url: o.url }) }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      warned = false;
    } catch (err) {
      // Once per outage, not every 30 seconds.
      if (!warned) log.warn(`[Runners] the runner manager at ${o.managerUrl} is not answering: ${(err as Error).message}`);
      warned = true;
    }
  };

  void beat();
  const timer = setInterval(() => { void beat(); }, HEARTBEAT_MS);
  timer.unref();
  return () => clearInterval(timer);
}
