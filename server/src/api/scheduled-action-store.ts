import { readFile, writeFile } from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { ScheduledActionDef } from '../store/team-snapshot.js';

export class ScheduledActionStore {
  private filePath: string;
  private actions = new Map<string, ScheduledActionDef>();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<void> {
    try {
      const raw   = await readFile(this.filePath, 'utf-8');
      const items = JSON.parse(raw) as ScheduledActionDef[];
      this.actions.clear();
      for (const a of items) this.actions.set(a.id, a);
    } catch { /* file doesn't exist yet — start empty */ }
  }

  list(): ScheduledActionDef[] {
    return [...this.actions.values()];
  }

  get(id: string): ScheduledActionDef | undefined {
    return this.actions.get(id);
  }

  async add(data: {
    label: string;
    description: string;
    intervalSeconds: number | null;
    cron?: string;
    type?: import('../store/team-snapshot.js').ScheduledActionType;
    mcpToolCall?: import('../store/team-snapshot.js').McpToolCallSpec;
    promptMode?: ScheduledActionDef['promptMode'];
  }): Promise<ScheduledActionDef> {
    const def: ScheduledActionDef = {
      id:              uuidv4(),
      label:           data.label,
      description:     data.description,
      intervalSeconds: data.intervalSeconds,
      ...(data.cron        && { cron: data.cron }),
      createdAt:       new Date().toISOString(),
      ...(data.type        && { type: data.type }),
      ...(data.mcpToolCall && { mcpToolCall: data.mcpToolCall }),
      ...(data.promptMode  && { promptMode: data.promptMode }),
    };
    this.actions.set(def.id, def);
    await this.save();
    return def;
  }

  /** Add an action under its own id, unless one already has it. True if added. */
  async addIfMissing(def: ScheduledActionDef): Promise<boolean> {
    if (this.actions.has(def.id)) return false;
    this.actions.set(def.id, def);
    await this.save();
    return true;
  }

  async update(id: string, patch: Partial<ScheduledActionDef>): Promise<ScheduledActionDef | undefined> {
    const existing = this.actions.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...patch, id };
    this.actions.set(id, updated);
    await this.save();
    return updated;
  }

  async remove(id: string): Promise<boolean> {
    const deleted = this.actions.delete(id);
    if (deleted) await this.save();
    return deleted;
  }

  private async save(): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(this.list(), null, 2), 'utf-8');
  }
}
