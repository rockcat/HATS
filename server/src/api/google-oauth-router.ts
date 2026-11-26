import { IncomingMessage, ServerResponse } from 'http';
import { GoogleTokenStore, GOOGLE_OAUTH_SCOPES } from './google-token-store.js';
import { AgentGoogleTokenStore } from './agent-google-token-store.js';
import { log } from '../../../packages/core/src/logger.js';

// The five personal Google MCP ids and the token env var each one expects.
export const GOOGLE_PERSONAL_MCPS = [
  { id: 'google-gmail-personal',    tokenVar: 'GOOGLE_GMAIL_ACCESS_TOKEN'    },
  { id: 'google-calendar-personal', tokenVar: 'GOOGLE_CALENDAR_ACCESS_TOKEN' },
  { id: 'google-drive-personal',    tokenVar: 'GOOGLE_DRIVE_ACCESS_TOKEN'    },
  { id: 'google-chat-personal',     tokenVar: 'GOOGLE_CHAT_ACCESS_TOKEN'     },
  { id: 'google-contacts-personal', tokenVar: 'GOOGLE_CONTACTS_ACCESS_TOKEN' },
] as const;

type AgentOAuthCallback = (
  agentName:        string,
  accessToken:      string,
  refreshToken:     string,
  expiresInSeconds: number,
  email?:           string,
) => Promise<void>;

// State encoded in the OAuth `state` param to survive the redirect round-trip.
interface OAuthState {
  mode:   'shared' | 'agent';
  agent?: string; // present when mode === 'agent'
}

import { finishPage } from './google-oauth-finish.js';

/**
 * Can this runner start a Google sign-in at all?
 *
 * Without both halves of the client credential the flow dead-ends on a
 * plain-text error in a popup — so the UI needs to know *before* it offers
 * a button, not after someone has pressed it.
 */
export function isGoogleOAuthConfigured(): boolean {
  return !!process.env['GOOGLE_CLIENT_ID'] && !!process.env['GOOGLE_CLIENT_SECRET'];
}

export class GoogleOAuthRouter {
  private tokenStore:        GoogleTokenStore;
  private agentTokenStore:   AgentGoogleTokenStore | null = null;
  private port:              number;
  private onAuthenticatedCb: (() => Promise<void>) | null = null;
  private onAgentAuthCb:     AgentOAuthCallback | null    = null;

  constructor(tokenStore: GoogleTokenStore, port: number) {
    this.tokenStore = tokenStore;
    this.port       = port;
  }

  /** Attach the per-agent token store (call before start()). */
  setAgentTokenStore(store: AgentGoogleTokenStore): void {
    this.agentTokenStore = store;
  }

  /** Called after the shared Google account is authenticated. */
  onAuthenticated(cb: () => Promise<void>): void {
    this.onAuthenticatedCb = cb;
  }

  /** Called after an agent's Google account is authenticated. */
  onAgentAuthenticated(cb: AgentOAuthCallback): void {
    this.onAgentAuthCb = cb;
  }

  async handleRoutes(pathname: string, method: string, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (!pathname.startsWith('/api/auth/google')) return false;

    // ── Shared: start ─────────────────────────────────────────────────────────
    if (pathname === '/api/auth/google/start' && method === 'GET') {
      return this._startOAuth(res, { mode: 'shared' });
    }

    // ── Agent: start ──────────────────────────────────────────────────────────
    if (pathname === '/api/auth/google/agent/start' && method === 'GET') {
      const url       = new URL(req.url ?? '', `http://localhost:${this.port}`);
      const agentName = url.searchParams.get('agent');
      if (!agentName) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Missing ?agent= parameter');
        return true;
      }
      return this._startOAuth(res, { mode: 'agent', agent: agentName });
    }

    // ── Shared callback (also handles agent flow via state param) ─────────────
    if (pathname === '/api/auth/google/callback' && method === 'GET') {
      return this._handleCallback(req, res);
    }

    // ── Shared: status ────────────────────────────────────────────────────────
    if (pathname === '/api/auth/google/status' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        authenticated: this.tokenStore.isAuthenticated(),
        configured: isGoogleOAuthConfigured(),
      }));
      return true;
    }

    // ── Agent: status ─────────────────────────────────────────────────────────
    if (pathname === '/api/auth/google/agent/status' && method === 'GET') {
      const url       = new URL(req.url ?? '', `http://localhost:${this.port}`);
      const agentName = url.searchParams.get('agent');
      if (!agentName || !this.agentTokenStore) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ authenticated: false, configured: isGoogleOAuthConfigured() }));
        return true;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        authenticated: this.agentTokenStore.isAuthenticated(agentName),
        email:         this.agentTokenStore.getEmail(agentName),
        configured:    isGoogleOAuthConfigured(),
      }));
      return true;
    }

    // ── Shared: disconnect ────────────────────────────────────────────────────
    if (pathname === '/api/auth/google' && method === 'DELETE') {
      await this.tokenStore.clear();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return true;
    }

    // ── Agent: disconnect ─────────────────────────────────────────────────────
    if (pathname === '/api/auth/google/agent' && method === 'DELETE') {
      const url       = new URL(req.url ?? '', `http://localhost:${this.port}`);
      const agentName = url.searchParams.get('agent');
      if (agentName && this.agentTokenStore) {
        await this.agentTokenStore.clear(agentName);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return true;
    }

    return false;
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private _startOAuth(res: ServerResponse, state: OAuthState): true {
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
    url.searchParams.set('scope',         GOOGLE_OAUTH_SCOPES + ' email profile');
    url.searchParams.set('access_type',   'offline');
    url.searchParams.set('prompt',        'consent');
    url.searchParams.set('state',         Buffer.from(JSON.stringify(state)).toString('base64'));
    res.writeHead(302, { Location: url.toString() });
    res.end();
    return true;
  }

  private async _handleCallback(req: IncomingMessage, res: ServerResponse): Promise<true> {
    const urlObj = new URL(req.url ?? '', `http://localhost:${this.port}`);
    const code   = urlObj.searchParams.get('code');
    const error  = urlObj.searchParams.get('error');

    const closeHtml = (
      msg: string,
      success: boolean,
      extra: { agent?: string; email?: string } = {},
    ) => finishPage({ success, message: msg, ...extra });

    // Parse state to know which flow this belongs to
    let oauthState: OAuthState = { mode: 'shared' };
    try {
      const rawState = urlObj.searchParams.get('state');
      if (rawState) oauthState = JSON.parse(Buffer.from(rawState, 'base64').toString('utf-8')) as OAuthState;
    } catch { /* default to shared */ }

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

      // Fetch the authenticated user's email for display purposes.
      let email: string | undefined;
      try {
        const infoRes  = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${data.access_token}` },
        });
        const infoData = await infoRes.json() as { email?: string };
        email = infoData.email;
      } catch { /* non-fatal */ }

      if (oauthState.mode === 'agent' && oauthState.agent) {
        // ── Per-agent flow ────────────────────────────────────────────────────
        const agentName = oauthState.agent;
        log.info(`[GoogleAuth] Agent "${agentName}" authenticated as ${email ?? 'unknown'}`);
        this.onAgentAuthCb?.(agentName, data.access_token, data.refresh_token, data.expires_in ?? 3600, email)
          .catch(err => log.error('[GoogleAuth] Agent post-auth callback error:', (err as Error).message));
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(closeHtml('', true, { agent: agentName, ...(email ? { email } : {}) }));
      } else {
        // ── Shared flow ───────────────────────────────────────────────────────
        await this.tokenStore.saveTokens(data.access_token, data.refresh_token, data.expires_in ?? 3600);
        log.info('[GoogleAuth] Shared account authenticated');
        this.onAuthenticatedCb?.().catch(err => log.error('[GoogleAuth] Post-auth callback error:', (err as Error).message));
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(closeHtml('', true));
      }
    } catch (err) {
      log.error('[GoogleAuth] Callback error:', (err as Error).message);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(closeHtml('server error', false));
    }
    return true;
  }
}
