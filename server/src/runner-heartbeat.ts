// ── Reporting in to the runner manager ───────────────────────────────────────
//
// So the dashboard can list every runner and switch between them, each one
// tells the runner manager which project it holds and where its dashboard
// is, every HEARTBEAT_MS. Launched by the manager or written into a compose
// file by hand, every runner does the same. Missing a beat costs nothing: the
// manager shows the runner as unreachable until the next one arrives.
//
// A runner in Docker also gives its container's id, so the manager can stop
// it from the dashboard, and says goodbye when it stops, so it is shown as
// stopped at once rather than as unreachable a minute and a half later.

import { existsSync } from 'fs';
import { hostname } from 'os';
import { log } from '../../packages/core/src/logger.js';
import { runnerToken, runnerTokenHeaders } from '../../packages/service-kit/src/runner-token.js';
import type { TeamCard } from '../../packages/contracts/src/types.js';

export const HEARTBEAT_MS = 30_000;

/** The installation's runner token, which the runner manager asks of every runner. */
const TOKEN_HEADERS = runnerTokenHeaders(runnerToken());

export interface HeartbeatOptions {
  managerUrl: string;
  /** The project held now; a runner that is not locked can switch. */
  project: () => string;
  port: number;
  /** A better address for the dashboard than the browser's host + port. */
  url?: string;
  /** This runner's container, when it runs in Docker. */
  container?: string;
  /** This team's card, for other teams finding it, read fresh for every beat. */
  card?: () => TeamCard | undefined;
  fetchImpl?: typeof fetch;
}

/**
 * This process's container id, when it runs in Docker: there, the host name
 * is the container's short id unless a compose file sets another.
 */
export function ownContainer(inDocker = existsSync('/.dockerenv'), name = hostname()): string | undefined {
  return inDocker && name ? name : undefined;
}

const endpoint = (managerUrl: string, what: 'heartbeat' | 'goodbye') =>
  `${managerUrl.replace(/\/$/, '')}/api/v1/runners/${what}`;

/** Report in now and on a timer. Returns a function that stops it. */
export function startHeartbeat(o: HeartbeatOptions): () => void {
  const target = endpoint(o.managerUrl, 'heartbeat');
  const send = o.fetchImpl ?? fetch;
  let warned = false;

  const beat = async () => {
    try {
      const card = o.card?.();
      const res = await send(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...TOKEN_HEADERS },
        body: JSON.stringify({
          project: o.project(), port: o.port,
          ...(o.url && { url: o.url }),
          ...(o.container && { container: o.container }),
          ...(card && { card }),
        }),
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

/** Tell the runner manager this runner is stopping. Best effort, and quick: it is on the way out. */
export async function sayGoodbye(o: Pick<HeartbeatOptions, 'managerUrl' | 'project' | 'fetchImpl'>): Promise<void> {
  await (o.fetchImpl ?? fetch)(endpoint(o.managerUrl, 'goodbye'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...TOKEN_HEADERS },
    body: JSON.stringify({ project: o.project() }),
    signal: AbortSignal.timeout(2_000),
  }).catch(() => {});
}
