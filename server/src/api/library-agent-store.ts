/**
 * An agent store backed by the standalone Agent Library service.
 *
 * With this in place the Team Runner no longer owns agent definitions — it
 * reads and writes them through the library API. Credentials are the one
 * exception: per-agent MCP secrets stay on the runner in a local sidecar file
 * and are never sent to a shared library.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import * as path from 'path';
import { AgentLibraryClient } from '../../../packages/clients/src/agent-library-client.js';
import type { AgentTemplate, HatTypeName, ProviderName } from '../../../packages/contracts/src/types.js';
import type { AgentDefinition } from '../store/team-snapshot.js';
import type { HatType } from '../../../packages/core/src/hats/types.js';
import { log } from '../../../packages/core/src/logger.js';
import type { AgentDefinitionStore } from './agent-store.js';

/** Fields that must never leave the runner. */
interface LocalAgentSecrets {
  personalMcpCredentials?: Record<string, Record<string, string>>;
  teamContext?: string;
}

export function templateToDefinition(template: AgentTemplate, secrets: LocalAgentSecrets = {}): AgentDefinition {
  const def: AgentDefinition = {
    id: template.id,
    identity: { name: template.name, ...template.identity },
    hatType: template.hats as unknown as HatType[],
    model: template.model.model,
    providerName: template.model.provider,
    scheduledActionIds: template.scheduledActionIds ?? [],
  };
  if (template.tools?.enabledMcpServers) def.enabledMcpServers = template.tools.enabledMcpServers;
  if (template.tools?.disabledPersonalMcpServers) def.disabledPersonalMcpServers = template.tools.disabledPersonalMcpServers;
  if (template.limits?.maxContextTokens !== undefined) def.maxContextTokens = template.limits.maxContextTokens;
  if (template.limits?.maxCostPerHour !== undefined) def.maxCostPerHour = template.limits.maxCostPerHour;
  if (secrets.personalMcpCredentials) def.personalMcpCredentials = secrets.personalMcpCredentials;
  if (secrets.teamContext) def.teamContext = secrets.teamContext;
  return def;
}

/** Pull out the fields that must stay on this machine. */
function extractSecrets(def: AgentDefinition): LocalAgentSecrets {
  const secrets: LocalAgentSecrets = {};
  if (def.personalMcpCredentials) secrets.personalMcpCredentials = def.personalMcpCredentials;
  if (def.teamContext) secrets.teamContext = def.teamContext;
  return secrets;
}

function definitionToTemplateInput(def: AgentDefinition) {
  const { name, ...identity } = def.identity;
  const limits: Record<string, number> = {};
  if (def.maxContextTokens !== undefined) limits['maxContextTokens'] = def.maxContextTokens;
  if (def.maxCostPerHour !== undefined) limits['maxCostPerHour'] = def.maxCostPerHour;

  const tools: Record<string, string[]> = {};
  if (def.enabledMcpServers) tools['enabledMcpServers'] = def.enabledMcpServers;
  if (def.disabledPersonalMcpServers) tools['disabledPersonalMcpServers'] = def.disabledPersonalMcpServers;

  return {
    name,
    hats: def.hatType as unknown as HatTypeName[],
    identity: { ...identity, visualDescription: identity.visualDescription || 'a focused, capable team member' },
    model: { provider: def.providerName as ProviderName, model: def.model },
    ...(Object.keys(limits).length > 0 && { limits }),
    ...(Object.keys(tools).length > 0 && { tools }),
    scheduledActionIds: def.scheduledActionIds ?? [],
  };
}

export class LibraryAgentStore implements AgentDefinitionStore {
  private readonly client: AgentLibraryClient;
  private readonly secretsPath: string;
  /** Library entries, keyed by template id. This is what `list()` exposes. */
  private readonly templates = new Map<string, AgentDefinition>();
  /** Configs of agents running right now, keyed by project instance id. */
  private readonly runtime = new Map<string, AgentDefinition>();
  private secrets: Record<string, LocalAgentSecrets> = {};

  constructor(client: AgentLibraryClient, secretsPath: string) {
    this.client = client;
    this.secretsPath = secretsPath;
  }

  /** True when the library service answered during the last load. */
  private reachable = false;
  get isReachable(): boolean { return this.reachable; }
  get libraryUrl(): string { return this.client.baseUrl; }

  /**
   * Credentials held back from the shared library, for one agent.
   *
   * Looked up by the running agent's instance id first, then by the template it
   * was deployed from: an agent configured before it was ever deployed has its
   * secrets filed under the template id.
   */
  secretsFor(id: string, templateId?: string): LocalAgentSecrets {
    return this.secrets[id] ?? (templateId ? this.secrets[templateId] : undefined) ?? {};
  }

  /** Store credentials for an agent without touching the shared library. */
  async setSecrets(id: string, secrets: LocalAgentSecrets): Promise<void> {
    this.secrets[id] = secrets;
    await this.writeSecrets();
  }

  async load(): Promise<void> {
    this.secrets = await this.readSecrets();
    try {
      const templates = await this.client.listTemplates();
      this.templates.clear();
      for (const template of templates) {
        this.templates.set(template.id, templateToDefinition(template, this.secrets[template.id] ?? {}));
      }
      this.reachable = true;
      log.info(`[AgentLibrary] loaded ${this.templates.size} template(s) from ${this.client.baseUrl}`);
    } catch (err) {
      this.reachable = false;
      log.warn(`[AgentLibrary] ${this.client.baseUrl} unreachable — the library will be empty this session: ${(err as Error).message}`);
    }
  }

  list(): AgentDefinition[] { return [...this.templates.values()]; }

  get(id: string): AgentDefinition | undefined {
    return this.runtime.get(id) ?? this.templates.get(id);
  }

  has(id: string): boolean {
    return this.runtime.has(id) || this.templates.has(id);
  }

  /** Create or edit a library template. */
  async addOrUpdate(def: AgentDefinition): Promise<AgentDefinition> {
    const secrets = extractSecrets(def);
    const input = definitionToTemplateInput(def);

    let saved: AgentTemplate | undefined;
    try {
      saved = def.id && this.templates.has(def.id)
        ? await this.client.updateTemplate(def.id, input)
        : await this.client.createTemplate(input);
    } catch (err) {
      log.warn(`[AgentLibrary] could not save "${def.identity.name}": ${(err as Error).message}`);
    }

    const id = saved?.id ?? def.id;
    if (id) { this.secrets[id] = secrets; await this.writeSecrets(); }

    const stored = saved ? templateToDefinition(saved, secrets) : { ...def, ...(id && { id }) };
    if (stored.id) this.templates.set(stored.id, stored);
    return stored;
  }

  /**
   * A running agent's id is its project instance id. If it happens to match a
   * template — an agent deployed before instance ids existed, or edited through
   * the library UI — the template is updated; otherwise the config is kept in
   * memory only. Either way no new library entry is minted, and the roster
   * itself is persisted by ProjectSync into the project definition.
   */
  async syncRunningAgent(def: AgentDefinition): Promise<void> {
    if (!def.id) return;
    this.runtime.set(def.id, def);
    this.secrets[def.id] = extractSecrets(def);
    await this.writeSecrets();
    if (!this.templates.has(def.id)) return;
    try {
      const saved = await this.client.updateTemplate(def.id, definitionToTemplateInput(def));
      if (saved) this.templates.set(saved.id, templateToDefinition(saved, this.secrets[def.id] ?? {}));
    } catch (err) {
      log.warn(`[AgentLibrary] could not update template ${def.id}: ${(err as Error).message}`);
    }
  }

  async remove(id: string): Promise<boolean> {
    this.runtime.delete(id);
    if (!this.templates.has(id)) return false;
    try {
      await this.client.deleteTemplate(id);
    } catch (err) {
      log.warn(`[AgentLibrary] could not delete ${id}: ${(err as Error).message}`);
      return false;
    }
    this.templates.delete(id);
    delete this.secrets[id];
    await this.writeSecrets();
    return true;
  }

  private async readSecrets(): Promise<Record<string, LocalAgentSecrets>> {
    try {
      return JSON.parse(await readFile(this.secretsPath, 'utf-8')) as Record<string, LocalAgentSecrets>;
    } catch {
      return {};
    }
  }

  private async writeSecrets(): Promise<void> {
    try {
      await mkdir(path.dirname(this.secretsPath), { recursive: true });
      await writeFile(this.secretsPath, JSON.stringify(this.secrets, null, 2), 'utf-8');
    } catch (err) {
      log.warn(`[AgentLibrary] could not persist local agent credentials: ${(err as Error).message}`);
    }
  }
}
