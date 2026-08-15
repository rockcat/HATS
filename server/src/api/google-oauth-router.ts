import { IncomingMessage, ServerResponse } from 'http';
import { GoogleTokenStore, GOOGLE_OAUTH_SCOPES } from './google-token-store.js';
import { log } from '../util/logger.js';

export class GoogleOAuthRouter {
  private tokenStore: GoogleTokenStore;
  private port: number;
  private onAuthenticatedCb: (() => Promise<void>) | null = null;

  constructor(tokenStore: GoogleTokenStore, port: number) {
    this.tokenStore = tokenStore;
    this.port = port;
  }

  onAuthenticated(cb: () => Promise<void>): void {
    this.onAuthenticatedCb = cb;
  }

  async handleRoutes(pathname: string, method: string, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (!pathname.startsWith('/api/auth/google')) return false;

    if (pathname === '/api/auth/google/start' && method === 'GET') {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      if (!clientId) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('GOOGLE_CLIENT_ID is not configured. Add it as an environment variable.');
        return true;
      }
      const redirectUri = `http://localhost:${this.port}/api/auth/google/callback`;
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.searchParams.set('client_id',     clientId);
      url.searchParams.set('redirect_uri',  redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope',         GOOGLE_OAUTH_SCOPES);
      url.searchParams.set('access_type',   'offline');
      url.searchParams.set('prompt',        'consent'); // force refresh_token in response
      res.writeHead(302, { Location: url.toString() });
      res.end();
      return true;
    }

    if (pathname === '/api/auth/google/callback' && method === 'GET') {
      const urlObj = new URL(req.url ?? '', `http://localhost:${this.port}`);
      const code   = urlObj.searchParams.get('code');
      const error  = urlObj.searchParams.get('error');

      const closeHtml = (msg: string, success: boolean) =>
        `<html><body><script>window.opener?.postMessage({type:'google-auth-${success ? 'success' : 'error'}',error:'${success ? '' : msg}'},'*');window.close();</script><p>${success ? 'Google authentication successful! You can close this window.' : `Authentication failed: ${msg}. You can close this window.`}</p></body></html>`;

      if (error || !code) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(closeHtml(error ?? 'no_code', false));
        return true;
      }

      const clientId     = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(closeHtml('OAuth credentials not configured', false));
        return true;
      }

      try {
        const redirectUri = `http://localhost:${this.port}/api/auth/google/callback`;
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method:  'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body:    new URLSearchParams({
            code,
            client_id:     clientId,
            client_secret: clientSecret,
            redirect_uri:  redirectUri,
            grant_type:    'authorization_code',
          }),
        });
        const data = await tokenRes.json() as {
          access_token?: string; refresh_token?: string; expires_in?: number;
          error?: string; error_description?: string;
        };

        if (!data.access_token || !data.refresh_token) {
          log.warn('[GoogleAuth] Token exchange failed:', data.error, data.error_description);
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(closeHtml(data.error_description ?? data.error ?? 'no_tokens', false));
          return true;
        }

        await this.tokenStore.saveTokens(data.access_token, data.refresh_token, data.expires_in ?? 3600);
        log.info('[GoogleAuth] Authenticated successfully');
        this.onAuthenticatedCb?.().catch((err) => log.error('[GoogleAuth] Post-auth callback error:', (err as Error).message));

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(closeHtml('', true));
      } catch (err) {
        log.error('[GoogleAuth] Callback error:', (err as Error).message);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(closeHtml('server error', false));
      }
      return true;
    }

    if (pathname === '/api/auth/google/status' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ authenticated: this.tokenStore.isAuthenticated() }));
      return true;
    }

    if (pathname === '/api/auth/google' && method === 'DELETE') {
      await this.tokenStore.clear();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return true;
    }

    return false;
  }
}
