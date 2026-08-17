import { randomBytes } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import type { UserStore, User } from './user-store.js';

export interface Session {
  userId:    string;
  username:  string;
  role:      'admin' | 'user';
  expiresAt: number;
}

const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 h
const sessions    = new Map<string, Session>();

export function createSession(user: User): string {
  const id = randomBytes(32).toString('hex');
  sessions.set(id, {
    userId: user.id, username: user.username, role: user.role,
    expiresAt: Date.now() + SESSION_TTL,
  });
  return id;
}

export function getSession(id: string): Session | null {
  const s = sessions.get(id);
  if (!s) return null;
  if (Date.now() > s.expiresAt) { sessions.delete(id); return null; }
  return s;
}

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
