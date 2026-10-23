/**
 * Storage for agent templates.
 *
 * Every write is schema-validated before it touches disk, so an invalid
 * template can only ever enter the library by someone editing a file by hand —
 * and `load()` reports those rather than silently accepting them.
 */

import { access, rename } from 'fs/promises';
import { JsonStore, readJsonFile } from '@hats/service-kit/json-store';
import {
  createAgentTemplate,
  patchAgentTemplate,
  replaceAgentTemplate,
} from '@hats/contracts/factories';
import { validateAgentTemplate } from '@hats/contracts/validate';
import type {
  AgentTemplate,
  AgentTemplateInput,
  ExternalEndpoint,
  HatTypeName,
  ProviderName,
} from '@hats/contracts/types';

/** Shape of the pre-rearchitecture `agents.json` entries. */
interface LegacyAgentDefinition {
  id: string;
  identity: {
    name: string;
    visualDescription: string;
    specialisation?: string;
    backstory?: string;
    email?: string;
    avatar?: string;
    background?: string;
    voice?: string;
    speakerName?: string;
  };
  hatType: string[];
  model: string;
  providerName: string;
  enabledMcpServers?: string[];
  disabledPersonalMcpServers?: string[];
  scheduledActionIds?: string[];
  maxContextTokens?: number;
  maxCostPerHour?: number;
  externalEndpoint?: ExternalEndpoint;
}

export interface TemplateQuery {
  q?: string;
  hat?: string;
  tag?: string;
}

export class TemplateStore {
  private readonly store: JsonStore<AgentTemplate>;
  private readonly invalid: Array<{ file: string; reason: string }> = [];

  constructor(dir: string) {
    this.store = new JsonStore<AgentTemplate>({
      dir,
      keyOf: (t) => t.id,
      onInvalid: (file, reason) => this.invalid.push({ file, reason }),
    });
  }

  async load(): Promise<void> {
    await this.store.load();
    for (const template of this.store.list()) {
      const result = validateAgentTemplate(template);
      if (!result.valid) {
        this.invalid.push({
          file: `${template.id}.json`,
          reason: result.errors.map((e) => `${e.path} ${e.message}`).join('; '),
        });
      }
    }
  }

  get invalidRecords(): ReadonlyArray<{ file: string; reason: string }> { return this.invalid; }
  get size(): number { return this.store.size; }

  list(query: TemplateQuery = {}): AgentTemplate[] {
    const needle = query.q?.trim().toLowerCase();
    return this.store.list()
      .filter((t) => !query.hat || t.hats.includes(query.hat as HatTypeName))
      .filter((t) => !query.tag || (t.tags ?? []).includes(query.tag))
      .filter((t) => {
        if (!needle) return true;
        const haystack = [t.name, t.description, t.identity.specialisation, t.identity.backstory]
          .filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(needle);
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(id: string): AgentTemplate | undefined { return this.store.get(id); }

  async create(input: AgentTemplateInput): Promise<AgentTemplate> {
    return this.persist(createAgentTemplate(input));
  }

  /** Merge a partial change over the stored template — the PATCH path. */
  async update(id: string, patch: Partial<AgentTemplateInput>): Promise<AgentTemplate | undefined> {
    const current = this.store.get(id);
    if (!current) return undefined;
    return this.persist(patchAgentTemplate(current, patch));
  }

  /**
   * Replace the template — the PUT path. A field the caller omits is dropped,
   * which is the only way to clear an optional one such as an MCP allow-list.
   */
  async replace(id: string, input: AgentTemplateInput): Promise<AgentTemplate | undefined> {
    const current = this.store.get(id);
    if (!current) return undefined;
    return this.persist(replaceAgentTemplate(current, input));
  }

  async duplicate(id: string, name?: string): Promise<AgentTemplate | undefined> {
    const source = this.store.get(id);
    if (!source) return undefined;
    const { id: _id, revision: _revision, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = source;
    return this.create({ ...rest, name: name?.trim() || `${source.name} (copy)` });
  }

  async remove(id: string): Promise<boolean> { return this.store.remove(id); }

  /** Validate then write. Throws with schema detail rather than storing garbage. */
  private async persist(template: AgentTemplate): Promise<AgentTemplate> {
    const result = validateAgentTemplate(template);
    if (!result.valid) {
      const error = new Error('Template failed schema validation') as Error & { details?: unknown };
      error.details = result.errors;
      throw error;
    }
    return this.store.put(template);
  }

  /**
   * One-time import of the flat `agents.json` the Team Runner used to own.
   * The source file is renamed to `.migrated` so the import never repeats.
   */
  async importLegacy(legacyFile: string): Promise<number> {
    try { await access(legacyFile); } catch { return 0; }
    const entries = await readJsonFile<LegacyAgentDefinition[]>(legacyFile, []);
    if (!Array.isArray(entries) || entries.length === 0) return 0;

    let imported = 0;
    for (const entry of entries) {
      if (!entry?.identity?.name) continue;
      if (this.store.has(entry.id)) continue;
      const template = createAgentTemplate({
        name: entry.identity.name,
        hats: (entry.hatType ?? ['none']) as HatTypeName[],
        identity: {
          visualDescription: entry.identity.visualDescription || 'a focused, capable team member',
          specialisation: entry.identity.specialisation,
          backstory: entry.identity.backstory,
          email: entry.identity.email,
          avatar: entry.identity.avatar,
          background: entry.identity.background,
          voice: entry.identity.voice,
          speakerName: entry.identity.speakerName,
        },
        model: {
          provider: (entry.providerName ?? 'anthropic') as ProviderName,
          model: entry.model || 'claude-haiku-4-5-20251001',
        },
        // Carried through so an external agent stays reachable after import.
        ...(entry.externalEndpoint && { externalEndpoint: entry.externalEndpoint }),
        limits: {
          ...(entry.maxContextTokens !== undefined && { maxContextTokens: entry.maxContextTokens }),
          ...(entry.maxCostPerHour !== undefined && { maxCostPerHour: entry.maxCostPerHour }),
        },
        tools: {
          ...(entry.enabledMcpServers && { enabledMcpServers: entry.enabledMcpServers }),
          ...(entry.disabledPersonalMcpServers && { disabledPersonalMcpServers: entry.disabledPersonalMcpServers }),
        },
        scheduledActionIds: entry.scheduledActionIds ?? [],
        tags: ['imported'],
      }, entry.id);
      try { await this.persist(template); imported++; }
      catch { /* a legacy row that cannot be made valid is skipped, not fatal */ }
    }

    if (imported > 0) await rename(legacyFile, `${legacyFile}.migrated`).catch(() => {});
    return imported;
  }
}
