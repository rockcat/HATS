import type { IncomingMessage, ServerResponse } from 'http';
import type { UserStore, User } from './user-store.js';
import { SessionStore, SESSION_TTL, type Session } from './session-store.js';

export type { Session };

const sessions = new SessionStore();

/** Restore sessions saved by a previous run, and keep saving them to `filePath`. */
export function loadSessions(filePath: string): Promise<void> { return sessions.load(filePath); }

export function createSession(user: User): string { return sessions.create(user); }

export function getSession(id: string): Session | null { return sessions.get(id); }

export function deleteSession(id: string): void { sessions.delete(id); }

function cookieVal(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers['cookie'] ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name)
      return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

export function parseRequestAuth(req: IncomingMessage, userStore: UserStore): Session | null {
  const sid = cookieVal(req, 'hats_session');
  if (sid) { const s = getSession(sid); if (s) return s; }

  const raw = (req.headers['x-api-key'] as string | undefined)
    ?? (req.headers['authorization'] as string | undefined)?.replace(/^Bearer\s+/i, '');
  if (raw) {
    // Could be a session token (sent by the web client via sessionStorage)
    const s = getSession(raw);
    if (s) return s;
    // Or a static API key
    const u = userStore.getUserByApiKey(raw);
    if (u) return { userId: u.id, username: u.username, role: u.role, expiresAt: Infinity };
  }
  return null;
}

export function setSessionCookie(res: ServerResponse, sessionId: string): void {
  res.setHeader('Set-Cookie',
    `hats_session=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL / 1000}`);
}

export function clearSessionCookie(res: ServerResponse): void {
  res.setHeader('Set-Cookie', 'hats_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}
