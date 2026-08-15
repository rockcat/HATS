import { readFile, writeFile } from 'fs/promises';
import { log } from '../util/logger.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export const GOOGLE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/contacts',
  'https://www.googleapis.com/auth/chat.messages',
].join(' ');

/** Single env var name injected into process.env for all Google HTTP MCPs. */
export const GOOGLE_TOKEN_ENV_VAR = 'GOOGLE_ACCESS_TOKEN';

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

export class GoogleTokenStore {
  private filePath: string;
  private tokens: StoredTokens | null = null;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<StoredTokens>;
      if (parsed.accessToken && parsed.refreshToken && parsed.expiresAt) {
        this.tokens = parsed as StoredTokens;
      }
    } catch { /* no tokens yet */ }
  }

  isAuthenticated(): boolean {
    return !!this.tokens?.refreshToken;
  }

  async getAccessToken(): Promise<string | null> {
    if (!this.tokens?.refreshToken) return null;
    if (Date.now() < this.tokens.expiresAt - 60_000) return this.tokens.accessToken;
    return this.refresh();
  }

  async saveTokens(accessToken: string, refreshToken: string, expiresInSeconds: number): Promise<void> {
    this.tokens = { accessToken, refreshToken, expiresAt: Date.now() + expiresInSeconds * 1000 };
    await writeFile(this.filePath, JSON.stringify(this.tokens, null, 2), 'utf-8');
    process.env[GOOGLE_TOKEN_ENV_VAR] = accessToken;
  }

  /** Refresh token if needed and update process.env. */
  async syncToEnv(): Promise<boolean> {
    const token = await this.getAccessToken();
    if (token) {
      process.env[GOOGLE_TOKEN_ENV_VAR] = token;
      return true;
    }
    return false;
  }

  async clear(): Promise<void> {
    this.tokens = null;
    delete process.env[GOOGLE_TOKEN_ENV_VAR];
    try { await writeFile(this.filePath, '{}', 'utf-8'); } catch { /* ignore */ }
  }

  private async refresh(): Promise<string | null> {
    const clientId     = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret || !this.tokens?.refreshToken) return null;
    try {
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id:     clientId,
          client_secret: clientSecret,
          refresh_token: this.tokens.refreshToken,
          grant_type:    'refresh_token',
        }),
      });
      const data = await res.json() as { access_token?: string; expires_in?: number; error?: string };
      if (!data.access_token) {
        log.warn('[GoogleAuth] Token refresh failed:', data.error);
        return null;
      }
      this.tokens.accessToken = data.access_token;
      this.tokens.expiresAt   = Date.now() + (data.expires_in ?? 3600) * 1000;
      await writeFile(this.filePath, JSON.stringify(this.tokens, null, 2), 'utf-8');
      return this.tokens.accessToken;
    } catch (err) {
      log.error('[GoogleAuth] Token refresh error:', (err as Error).message);
      return null;
    }
  }
}
