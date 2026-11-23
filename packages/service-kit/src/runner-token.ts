/**
 * The installation's runner token: what runners show the services when they
 * report in, search for teams and move agents between teams, so that nothing
 * else on the network can pretend to be a runner.
 *
 * One secret for the whole installation, HATS_RUNNER_TOKEN in the shared
 * .env, which the installer writes and every runner and service reads. A
 * service without one accepts every caller, as before, and says so once.
 */

import { timingSafeEqual } from 'crypto';
import type { IncomingMessage } from 'http';

export const RUNNER_TOKEN_ENV = 'HATS_RUNNER_TOKEN';

/** The token from the environment, or undefined when none is set. */
export function runnerToken(env: Record<string, string | undefined> = process.env): string | undefined {
  return env[RUNNER_TOKEN_ENV]?.trim() || undefined;
}

/** The header that carries it. */
export function runnerTokenHeaders(token: string | undefined): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const sameSecret = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * A check for requests that only runners make: true when the request carries
 * `token`, or when no token is set. `warn` is told once that anyone is let in.
 */
export function runnerGate(token: string | undefined, warn: (message: string) => void = console.warn): (req: IncomingMessage) => boolean {
  let warned = false;
  return (req) => {
    if (!token) {
      if (!warned) {
        warned = true;
        warn(`[Runners] ${RUNNER_TOKEN_ENV} is not set, so any caller is taken for a runner. Set it in .env.`);
      }
      return true;
    }
    const given = (req.headers['authorization'] ?? '').toString().replace(/^Bearer\s+/i, '');
    return given.length > 0 && sameSecret(given, token);
  };
}
