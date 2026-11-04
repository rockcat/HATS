import { randomBytes } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import * as path from 'path';

export interface Session {
  userId:    string;
  username:  string;
  role:      'admin' | 'user';
  expiresAt: number;
}

export const SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days, renewed while in use
const RENEW_AFTER        = 60 * 60 * 1000;           // renew at most hourly, to keep writes rare

/**
 * Login sessions, optionally persisted to disk.
 *
 * Kept on disk so a restart of the runner (a watch reload, a container
 * restart) does not sign everyone out. Without a file path it is memory-only.
 */
export class SessionStore {
  private sessions = new Map<string, Session>();
  private writing: Promise<void> = Promise.resolve();

  constructor(private filePath: string | null = null) {}

  /** Read sessions from `filePath` (and persist there from now on), dropping expired ones. */
  async load(filePath: string): Promise<void> {
    this.filePath = filePath;
    try {
      const saved = JSON.parse(await readFile(filePath, 'utf-8')) as Record<string, Session>;
      const now   = Date.now();
      for (const [id, s] of Object.entries(saved)) if (s.expiresAt > now) this.sessions.set(id, s);
    } catch {
      // No file yet, or unreadable — start empty.
    }
  }

  create(user: { id: string; username: string; role: 'admin' | 'user' }): string {
    const id = randomBytes(32).toString('hex');
    this.sessions.set(id, {
      userId: user.id, username: user.username, role: user.role,
      expiresAt: Date.now() + SESSION_TTL,
    });
    this.persist();
    return id;
  }

  /** The live session for `id`, renewing its expiry when it is being used. */
  get(id: string): Session | null {
    const s = this.sessions.get(id);
    if (!s) return null;
    const now = Date.now();
    if (now > s.expiresAt) { this.delete(id); return null; }
    if (s.expiresAt - now < SESSION_TTL - RENEW_AFTER) {
      s.expiresAt = now + SESSION_TTL;
      this.persist();
    }
    return s;
  }

  delete(id: string): void {
    if (this.sessions.delete(id)) this.persist();
  }

  /** Writes are chained so an older snapshot never lands after a newer one. */
  private persist(): void {
    const filePath = this.filePath;
    if (!filePath) return;
    const data = JSON.stringify(Object.fromEntries(this.sessions), null, 2);
    this.writing = this.writing
      .then(async () => {
        await mkdir(path.dirname(filePath), { recursive: true });
        await writeFile(filePath, data, { encoding: 'utf-8', mode: 0o600 });
      })
      .catch(err => console.error('[Auth] Could not save sessions:', err));
  }

  /** Resolves once every write queued so far has finished. */
  flushed(): Promise<void> { return this.writing; }
}
