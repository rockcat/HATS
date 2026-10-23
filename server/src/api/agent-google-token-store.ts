import { mkdir, readdir, readFile, writeFile } from 'fs/promises';
import * as path from 'path';
import { log } from '../../../packages/core/src/logger.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

interface AgentTokens {
  accessToken:  string;
  refreshToken: string;
  expiresAt:    number; // epoch ms
  email?:       string;
}

/**
 * Per-agent Google OAuth token store.
 * Each agent's tokens are saved to {dir}/{sanitisedName}.json.
 * Access tokens are auto-refreshed when near expiry.
 */
export class AgentGoogleTokenStore {
  private dir:   string;
  private store = new Map<string, AgentTokens>(); // key = lowercase agent name

  constructor(dir: string) {
    this.dir = dir;
  }

  /** Load all existing agent token files from disk. */
  async loadAll(): Promise<void> {
    try {
      await mkdir(this.dir, { recursive: true });
      const files = await readdir(this.dir);
      await Promise.all(
        files
          .filter(f => f.endsWith('.json'))
          .map(f => this._loadFile(f.slice(0, -5))),
      );
    } catch { /* directory may not exist yet */ }
  }

  isAuthenticated(agentName: string): boolean {
    return !!this.store.get(agentName.toLowerCase())?.refreshToken;
  }

  getEmail(agentName: string): string | undefined {
    return this.store.get(agentName.toLowerCase())?.email;
  }

  /** Get a valid access token, refreshing if needed. Returns null if not authenticated. */
  async getAccessToken(agentName: string): Promise<string | null> {
    const key    = agentName.toLowerCase();
    const tokens = this.store.get(key);
    if (!tokens?.refreshToken) return null;
    if (Date.now() < tokens.expiresAt - 60_000) return tokens.accessToken;
    return this._refresh(agentName);
  }

  async saveTokens(agentName: string, accessToken: string, refreshToken: string, expiresInSeconds: number, email?: string): Promise<void> {
    const key    = agentName.toLowerCase();
    const tokens: AgentTokens = {
      accessToken,
      refreshToken,
      expiresAt: Date.now() + expiresInSeconds * 1000,
      email,
    };
    this.store.set(key, tokens);
    await mkdir(this.dir, { recursive: true });
    await writeFile(this._tokenPath(key), JSON.stringify(tokens, null, 2), 'utf-8');
  }

  async clear(agentName: string): Promise<void> {
    const key = agentName.toLowerCase();
    this.store.delete(key);
    try { await writeFile(this._tokenPath(key), '{}', 'utf-8'); } catch { /* ignore */ }
  }

  /** Names of all agents with stored tokens (lowercase). */
  listAgents(): string[] {
    return Array.from(this.store.keys());
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private _tokenPath(key: string): string {
    const safe = key.replace(/[^a-z0-9_-]/g, '_');
    return path.join(this.dir, `${safe}.json`);
  }

  private async _loadFile(key: string): Promise<void> {
    try {
      const raw    = await readFile(this._tokenPath(key), 'utf-8');
      const parsed = JSON.parse(raw) as Partial<AgentTokens>;
      if (parsed.accessToken && parsed.refreshToken && parsed.expiresAt) {
        this.store.set(key, parsed as AgentTokens);
      }
    } catch { /* corrupt or missing */ }
  }

  private async _refresh(agentName: string): Promise<string | null> {
    const key    = agentName.toLowerCase();
    const tokens = this.store.get(key);
    const clientId     = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret || !tokens?.refreshToken) return null;
    try {
      const res  = await fetch(TOKEN_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    new URLSearchParams({
          client_id:     clientId,
          client_secret: clientSecret,
          refresh_token: tokens.refreshToken,
          grant_type:    'refresh_token',
        }),
      });
      const data = await res.json() as { access_token?: string; expires_in?: number; error?: string };
      if (!data.access_token) {
        log.warn(`[GoogleAuth:${agentName}] Token refresh failed:`, data.error);
        return null;
      }
      tokens.accessToken = data.access_token;
      tokens.expiresAt   = Date.now() + (data.expires_in ?? 3600) * 1000;
      await writeFile(this._tokenPath(key), JSON.stringify(tokens, null, 2), 'utf-8');
      log.info(`[GoogleAuth:${agentName}] Access token refreshed`);
      return tokens.accessToken;
    } catch (err) {
      log.error(`[GoogleAuth:${agentName}] Refresh error:`, (err as Error).message);
      return null;
    }
  }
}
