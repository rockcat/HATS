import { randomBytes } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import type { UserStore } from './user-store.js';
import {
  createSession, deleteSession,
  setSessionCookie, clearSessionCookie, parseRequestAuth,
} from './auth-middleware.js';
import { readBody } from './api-utils.js';

// Short-lived pairing tokens → { userId, expiresAt }
const pairingTokens = new Map<string, { userId: string; expiresAt: number }>();
const PAIR_TTL      = 5 * 60 * 1000; // 5 minutes

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function cookieSessionId(req: IncomingMessage): string | null {
  for (const part of (req.headers['cookie'] ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq >= 0 && part.slice(0, eq).trim() === 'hats_session')
      return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

export class AuthRouter {
  constructor(private readonly userStore: UserStore, private readonly port: number) {}

  async handleRoutes(pathname: string, method: string, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (!pathname.startsWith('/api/auth/')) return false;

    // POST /api/auth/login — public
    if (pathname === '/api/auth/login' && method === 'POST') {
      const { username, password } = JSON.parse(await readBody(req)) as Record<string, string>;
      const user = await this.userStore.verifyPassword(username?.trim() ?? '', password ?? '');
      if (!user) { json(res, 401, { error: 'Invalid username or password' }); return true; }
      const sid = createSession(user);
      setSessionCookie(res, sid);
      json(res, 200, { ok: true, user: this.userStore.toPublic(user) });
      return true;
    }

    // POST /api/auth/logout
    if (pathname === '/api/auth/logout' && method === 'POST') {
      const sid = cookieSessionId(req);
      if (sid) deleteSession(sid);
      clearSessionCookie(res);
      json(res, 200, { ok: true });
      return true;
    }

    // GET /api/auth/me
    if (pathname === '/api/auth/me' && method === 'GET') {
      const session = parseRequestAuth(req, this.userStore);
      if (!session) { json(res, 401, { error: 'Not authenticated' }); return true; }
      const user = this.userStore.getById(session.userId);
      if (!user)  { json(res, 401, { error: 'Not authenticated' }); return true; }
      json(res, 200, this.userStore.toPublic(user));
      return true;
    }

    // POST /api/auth/pair/generate — generates a QR code for mobile pairing
    if (pathname === '/api/auth/pair/generate' && method === 'POST') {
      const session = parseRequestAuth(req, this.userStore);
      if (!session) { json(res, 401, { error: 'Not authenticated' }); return true; }

      const token   = randomBytes(24).toString('hex');
      const expires = Date.now() + PAIR_TTL;
      pairingTokens.set(token, { userId: session.userId, expiresAt: expires });

      const host    = req.headers['host'] ?? `localhost:${this.port}`;
      const pairUrl = `http://${host}/api/auth/pair/${token}`;

      let qrSvg = '';
      try {
        const QRCode = (await import('qrcode')).default;
        // width:2048 → 2048-unit SVG viewBox; displayed size is controlled by CSS
        qrSvg = await QRCode.toString(pairUrl, {
          type: 'svg', width: 2048, margin: 2, errorCorrectionLevel: 'M',
        });
      } catch {
        json(res, 500, { error: 'QR generation failed' }); return true;
      }

      json(res, 200, { token, url: pairUrl, qrSvg, expiresIn: PAIR_TTL / 1000 });
      return true;
    }

    // GET /api/auth/pair/:token — public; validates pairing token and issues API key
    if (pathname.startsWith('/api/auth/pair/') && method === 'GET') {
      const token = pathname.slice('/api/auth/pair/'.length);
      const entry = pairingTokens.get(token);
      if (!entry || Date.now() > entry.expiresAt) {
        pairingTokens.delete(token);
        json(res, 410, { error: 'Pairing link has expired or is invalid' }); return true;
      }
      pairingTokens.delete(token);

      const user = this.userStore.getById(entry.userId);
      if (!user) { json(res, 404, { error: 'User not found' }); return true; }

      const apiKey = await this.userStore.createApiKey(user.id, 'Mobile (paired)');
      json(res, 200, { ok: true, username: user.username, apiKey: apiKey.key, keyId: apiKey.id });
      return true;
    }

    return false;
  }
}
