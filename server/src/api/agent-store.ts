import { readFile, writeFile } from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { AgentDefinition } from '../store/team-snapshot.js';

/**
 * The runner's view of the agent library.
 *
 * Two implementations exist: `AgentStore` keeps definitions in a local file,
 * and `LibraryAgentStore` delegates to the standalone Agent Library service.
 * The runner works against this interface so it does not care which is in play.
 */
export interface AgentDefinitionStore {
  load(): Promise<void>;
  /** The library's own entries. Never includes agents that only exist at runtime. */
  list(): AgentDefinition[];
  get(id: string): AgentDefinition | undefined;
  has(id: string): boolean;
  /**
   * Create or edit a library entry. Running agents never come through here:
   * each is a copy kept in its project, so the library only changes when a
   * template is edited.
   */
  addOrUpdate(def: AgentDefinition): Promise<AgentDefinition>;
  remove(id: string): Promise<boolean>;
  /**
   * Per-agent MCP credentials, which never travel in a project definition or a
   * shared library. Returns an empty object when the store keeps none.
   */
  secretsFor?(id: string, templateId?: string): AgentSecrets;
  /** Store an agent's credentials on this machine only. */
  setSecrets?(id: string, secrets: AgentSecrets): Promise<void>;
}

/** What an agent keeps on this machine rather than in the shared library. */
export interface AgentSecrets {
  personalMcpCredentials?: Record<string, Record<string, string>>;
  teamContext?: string;
}

/** File-backed store — the fallback used when no Agent Library service is reachable. */
export class AgentStore implements AgentDefinitionStore {
  private filePath: string;
  private agents = new Map<string, AgentDefinition>();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<void> {
    try {
      const raw   = await readFile(this.filePath, 'utf-8');
      const items = JSON.parse(raw) as AgentDefinition[];
      this.agents.clear();
      for (const a of items) this.agents.set(a.id, a);
    } catch { /* file doesn't exist yet — start empty */ }
  }

  list(): AgentDefinition[] {
    return [...this.agents.values()];
  }

  get(id: string): AgentDefinition | undefined {
    return this.agents.get(id);
  }

  has(id: string): boolean {
    return this.agents.has(id);
  }

  async addOrUpdate(def: AgentDefinition): Promise<AgentDefinition> {
    const entry: AgentDefinition = { ...def, id: def.id || uuidv4() };
    this.agents.set(entry.id, entry);
    await this.save();
    return entry;
  }

  async remove(id: string): Promise<boolean> {
    const deleted = this.agents.delete(id);
    if (deleted) await this.save();
    return deleted;
  }

  private async save(): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(this.list(), null, 2), 'utf-8');
  }
}
