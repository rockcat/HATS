import { readFile, writeFile } from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { AgentDefinition } from '../store/team-snapshot.js';

export class AgentStore {
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
