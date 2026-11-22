// ── Sign-in, answered by the auth service ────────────────────────────────────
//
// A runner sharing sign-in passes its login, user and phone-pairing routes on
// to the auth service, which runs the same AuthRouter and UserManagementRouter
// a runner on its own does. The browser and the phone apps see no difference:
// same paths, same answers, and the session cookie is set for the runner's
// own address.
//
// Google sign-in is not among them. Google tokens belong to each runner.

import type { IncomingMessage, ServerResponse } from 'http';
import { Readable } from 'stream';

/** The routes the auth service answers. */
export function isSharedAuthRoute(pathname: string): boolean {
  if (pathname.startsWith('/api/auth/google')) return false;
  return pathname === '/api/auth/login' || pathname === '/api/auth/logout' || pathname === '/api/auth/me'
    || pathname.startsWith('/api/auth/pair/')
    || pathname === '/api/users' || pathname.startsWith('/api/users/');
}

const FORWARDED_HEADERS = ['content-type', 'cookie', 'authorization', 'x-api-key', 'user-agent'];

/** Forward one request and stream the answer back, Set-Cookie included. */
export async function forwardToAuthService(
  baseUrl: string, req: IncomingMessage, res: ServerResponse, runnerPort: number,
): Promise<void> {
  const headers: Record<string, string> = {};
  for (const name of FORWARDED_HEADERS) {
    const value = req.headers[name];
    if (typeof value === 'string') headers[name] = value;
  }
  // So phone-pairing links point at this runner, where the phone can reach
  // them, rather than at the auth service.
  const host = req.headers['host'];
  if (host) headers['x-forwarded-host'] = host;
  headers['x-forwarded-port'] = String(runnerPort);

  const method = req.method ?? 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';
  try {
    const upstream = await fetch(`${baseUrl.replace(/\/$/, '')}${req.url ?? '/'}`, {
      method,
      headers,
      ...(hasBody && { body: Readable.toWeb(req) as unknown as BodyInit, duplex: 'half' }),
      signal: AbortSignal.timeout(15_000),
    } as RequestInit);
    const out: Record<string, string | string[]> = {};
    const type = upstream.headers.get('content-type');
    if (type) out['Content-Type'] = type;
    const cookies = upstream.headers.getSetCookie();
    if (cookies.length > 0) out['Set-Cookie'] = cookies;
    res.writeHead(upstream.status, out);
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'The sign-in service is not answering' }));
  }
}
