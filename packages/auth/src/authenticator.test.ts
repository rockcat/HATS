import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type IncomingMessage, type Server } from 'http';
import type { AddressInfo } from 'net';
import { REMOTE_CACHE_MS, credentialOf, remoteAuthenticator, rememberSession, sessionOf } from './authenticator.js';
import { forwardToAuthService, isSharedAuthRoute } from './auth-proxy.js';

const req = (headers: Record<string, string>) => ({ headers }) as unknown as IncomingMessage;

describe('the credential a request carries', () => {
  it('prefers the session cookie, then an API key, then a bearer token', () => {
    expect(credentialOf(req({ cookie: 'a=1; hats_session=sid1', 'x-api-key': 'key' }))).toBe('sid1');
    expect(credentialOf(req({ 'x-api-key': 'key', authorization: 'Bearer tok' }))).toBe('key');
    expect(credentialOf(req({ authorization: 'Bearer tok' }))).toBe('tok');
    expect(credentialOf(req({}))).toBeNull();
  });
});

describe('checking with the auth service', () => {
  const user = { id: 'u1', username: 'paul', role: 'admin' };

  it('asks once, then trusts the answer for a while', async () => {
    let calls = 0;
    let now = 0;
    const auth = remoteAuthenticator('http://auth:3090', (async (_url: string, init?: RequestInit) => {
      calls++;
      expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer sid1');
      return new Response(JSON.stringify(user), { status: 200 });
    }) as typeof fetch, () => now);

    const r = req({ cookie: 'hats_session=sid1' });
    expect(await auth.authenticate(r)).toMatchObject({ userId: 'u1', username: 'paul', role: 'admin' });
    await auth.authenticate(r);
    expect(calls).toBe(1);

    now += REMOTE_CACHE_MS + 1;
    await auth.authenticate(r);
    expect(calls).toBe(2);
  });

  it('lets nobody in when the service says no, or is not there', async () => {
    const no = remoteAuthenticator('http://auth', (async () => new Response('{}', { status: 401 })) as typeof fetch);
    expect(await no.authenticate(req({ cookie: 'hats_session=bad' }))).toBeNull();
    const down = remoteAuthenticator('http://auth', (async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch);
    expect(await down.authenticate(req({ cookie: 'hats_session=x' }))).toBeNull();
    expect(await down.authenticate(req({}))).toBeNull();
  });

  it('remembers who made a request for later checks', () => {
    const r = req({});
    expect(sessionOf(r)).toBeNull();
    rememberSession(r, { userId: 'u', username: 'p', role: 'user', expiresAt: 1 });
    expect(sessionOf(r)?.username).toBe('p');
  });
});

describe('which routes the auth service answers', () => {
  it('takes sign-in, users and pairing, but leaves Google sign-in to the runner', () => {
    for (const p of ['/api/auth/login', '/api/auth/logout', '/api/auth/me', '/api/auth/pair/generate', '/api/auth/pair/abc', '/api/users', '/api/users/u1/api-keys/k']) {
      expect(isSharedAuthRoute(p), p).toBe(true);
    }
    for (const p of ['/api/auth/google/start', '/api/auth/google/callback', '/api/state', '/api/usersx']) {
      expect(isSharedAuthRoute(p), p).toBe(false);
    }
  });
});

describe('forwarding to the auth service', () => {
  let servers: Server[] = [];
  afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });
  const listen = async (handler: Parameters<typeof createServer>[0]) => {
    const s = createServer(handler);
    servers.push(s);
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  };

  it('passes the body and cookie through, and the session cookie back', async () => {
    const auth = await listen((r, res) => {
      let body = '';
      r.on('data', (c) => { body += c; });
      r.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'hats_session=new; HttpOnly; Path=/' });
        res.end(JSON.stringify({ body, cookie: r.headers['cookie'], host: r.headers['x-forwarded-host'], port: r.headers['x-forwarded-port'] }));
      });
    });
    const runner = await listen((r, res) => { void forwardToAuthService(auth, r, res, 3002); });

    const res = await fetch(`${runner}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: 'other=1' },
      body: JSON.stringify({ username: 'paul', password: 'pw' }),
    });
    expect(res.headers.get('set-cookie')).toContain('hats_session=new');
    const seen = await res.json() as { body: string; cookie: string; host: string; port: string };
    expect(JSON.parse(seen.body)).toEqual({ username: 'paul', password: 'pw' });
    expect(seen.cookie).toBe('other=1');
    expect(seen.port).toBe('3002');
    expect(seen.host).toMatch(/^127\.0\.0\.1:/);
  });

  it('says the service is down rather than hanging', async () => {
    const runner = await listen((r, res) => { void forwardToAuthService('http://127.0.0.1:9', r, res, 3002); });
    expect((await fetch(`${runner}/api/auth/me`)).status).toBe(503);
  });
});
