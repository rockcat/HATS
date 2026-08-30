/**
 * Per-agent MCP credentials.
 *
 * These never enter a template document or a project definition — a library is
 * shared and a project definition travels, but a credential should do neither.
 * They live in a runner-local sidecar instead, the same file the Team Runner
 * reads through `LibraryAgentStore.secretsFor()`, keyed by the id that
 * identifies the agent: the template id here, the deployed instance id there.
 */

import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import * as path from 'path';

export type CredentialSet = Record<string, string>;

export interface AgentSecrets {
  personalMcpCredentials?: Record<string, CredentialSet>;
  disabledPersonalMcpServers?: string[];
  teamContext?: string;
}

/** Field names that must never be sent back to a browser in the clear. */
const SECRET_NAME = /PASSWORD|TOKEN|SECRET|_KEY$|APIKEY|API_KEY|CREDENTIAL/i;

/** Returned in place of a stored secret; sending it back means "leave unchanged". */
export const SECRET_PLACEHOLDER = '__stored__';

export const isSecretField = (name: string): boolean => SECRET_NAME.test(name);

export class CredentialStore {
  private readonly filePath: string;
  private secrets: Record<string, AgentSecrets> = {};

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<void> {
    try {
      this.secrets = JSON.parse(await readFile(this.filePath, 'utf-8')) as Record<string, AgentSecrets>;
    } catch {
      this.secrets = {};
    }
  }

  /** Re-read before every access — the Team Runner writes this file too. */
  private async refresh(): Promise<void> {
    await this.load();
  }

  async credentialsFor(agentId: string): Promise<Record<string, CredentialSet>> {
    await this.refresh();
    return this.secrets[agentId]?.personalMcpCredentials ?? {};
  }

  async disabledFor(agentId: string): Promise<string[]> {
    await this.refresh();
    return this.secrets[agentId]?.disabledPersonalMcpServers ?? [];
  }

  /**
   * Store one server's credentials.
   *
   * Merges over what is already held rather than replacing it: a field the
   * caller omits keeps its stored value, and a field sent as the placeholder
   * keeps its stored secret. That way a partial update cannot silently discard
   * settings the caller never saw. Use `removeServer` to clear a server.
   */
  async saveServer(agentId: string, serverId: string, incoming: CredentialSet): Promise<CredentialSet> {
    await this.refresh();
    const entry = this.secrets[agentId] ?? {};
    const all = entry.personalMcpCredentials ?? {};
    const existing = all[serverId] ?? {};

    const merged: CredentialSet = { ...existing };
    for (const [key, value] of Object.entries(incoming)) {
      if (value === SECRET_PLACEHOLDER) continue;   // keep the stored secret
      merged[key] = value;
    }

    all[serverId] = merged;
    entry.personalMcpCredentials = all;
    // Saving a server re-enables it.
    entry.disabledPersonalMcpServers = (entry.disabledPersonalMcpServers ?? []).filter((id) => id !== serverId);
    this.secrets[agentId] = entry;
    await this.persist();
    return merged;
  }

  /** Forget a server's credentials entirely. */
  async removeServer(agentId: string, serverId: string): Promise<boolean> {
    await this.refresh();
    const entry = this.secrets[agentId];
    if (!entry?.personalMcpCredentials?.[serverId]) return false;
    delete entry.personalMcpCredentials[serverId];
    entry.disabledPersonalMcpServers = (entry.disabledPersonalMcpServers ?? []).filter((id) => id !== serverId);
    await this.persist();
    return true;
  }

  /** Keep the credentials but stop the runner starting the server. */
  async setDisabled(agentId: string, serverId: string, disabled: boolean): Promise<void> {
    await this.refresh();
    const entry = this.secrets[agentId] ?? {};
    const list = new Set(entry.disabledPersonalMcpServers ?? []);
    if (disabled) list.add(serverId); else list.delete(serverId);
    entry.disabledPersonalMcpServers = [...list];
    this.secrets[agentId] = entry;
    await this.persist();
  }

  /** Drop everything for an agent — used when its template is deleted. */
  async forget(agentId: string): Promise<void> {
    await this.refresh();
    if (!this.secrets[agentId]) return;
    delete this.secrets[agentId];
    await this.persist();
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    await writeFile(temp, JSON.stringify(this.secrets, null, 2), 'utf-8');
    await rename(temp, this.filePath);
  }
}

/** Replace secret values with the placeholder before sending to a client. */
export function maskCredentials(credentials: CredentialSet): CredentialSet {
  const masked: CredentialSet = {};
  for (const [key, value] of Object.entries(credentials)) {
    masked[key] = isSecretField(key) && value ? SECRET_PLACEHOLDER : value;
  }
  return masked;
}
