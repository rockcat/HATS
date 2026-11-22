// ── Who is asking ────────────────────────────────────────────────────────────
//
// A runner on its own checks a request against its own users and sessions. A
// runner sharing sign-in with others asks the auth service instead, so one
// sign-in works on every runner: the hats_session cookie ignores ports, so
// the browser sends it to all of them.
//
// Either way the check is made once per request, by the API server's gate,
// and remembered against the request. Anything later that needs the caller
// (an admin check, say) reads it from there rather than checking again.

import type { IncomingMessage } from 'http';
import { cookieVal, parseRequestAuth } from './auth-middleware.js';
import type { Session } from './session-store.js';
import type { UserStore } from './user-store.js';

export interface Authenticator {
  authenticate(req: IncomingMessage): Promise<Session | null>;
}

/** The session cookie, or else an API key or session id from the headers. */
export function credentialOf(req: IncomingMessage): string | null {
  return cookieVal(req, 'hats_session')
    ?? (req.headers['x-api-key'] as string | undefined)
    ?? (req.headers['authorization'] as string | undefined)?.replace(/^Bearer\s+/i, '')
    ?? null;
}

/** This runner's own users and sessions. */
export function localAuthenticator(userStore: UserStore): Authenticator {
  return { authenticate: async (req) => parseRequestAuth(req, userStore) };
}

/** How long a remote answer is trusted. A role change or sign-out reaches every runner within it. */
export const REMOTE_CACHE_MS = 30_000;

/** The shared auth service, asked once per credential per REMOTE_CACHE_MS. */
export function remoteAuthenticator(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Authenticator {
  const base = baseUrl.replace(/\/$/, '');
  const cache = new Map<string, { session: Session; until: number }>();

  type RemoteUser = { id: string; username: string; role: Session['role'] };
  const fetchUser = async (credential: string): Promise<RemoteUser | null> => {
    try {
      const res = await fetchImpl(`${base}/api/auth/me`, {
        headers: { Authorization: `Bearer ${credential}` },
        signal: AbortSignal.timeout(5_000),
      });
      return res.ok ? await res.json() as RemoteUser : null;
    } catch {
      // The auth service is down. Nobody can be checked, so nobody gets in;
      // answers already cached carry on until they expire.
      return null;
    }
  };

  return {
    async authenticate(req) {
      const credential = credentialOf(req);
      if (!credential) return null;
      const hit = cache.get(credential);
      if (hit && hit.until > now()) return hit.session;

      const user = await fetchUser(credential);
      if (!user) { cache.delete(credential); return null; }

      const session: Session = { userId: user.id, username: user.username, role: user.role, expiresAt: Infinity };
      cache.set(credential, { session, until: now() + REMOTE_CACHE_MS });
      return session;
    },
  };
}

const remembered = new WeakMap<IncomingMessage, Session>();

/** Record who made this request. Called by the gate. */
export function rememberSession(req: IncomingMessage, session: Session): void {
  remembered.set(req, session);
}

/** Who made this request, as the gate found. */
export function sessionOf(req: IncomingMessage): Session | null {
  return remembered.get(req) ?? null;
}
