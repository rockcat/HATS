import { v4 as uuidv4 } from 'uuid';
import { readFile, writeFile } from 'fs/promises';
import { McpToolCallSpec, ScheduledActionType } from '../store/team-snapshot.js';

export interface AgendaEntry {
  id: string;
  agentName: string;
  label: string;
  description: string;
  intervalSeconds: number | null;
  nextRunAt: number;
  enabled: boolean;
  createdAt: string;
  type?: ScheduledActionType;
  mcpToolCall?: McpToolCallSpec;
  /** The global scheduled action this entry was assigned from, if any. */
  actionId?: string;
  /** When it last fired successfully (ms since epoch). */
  lastRunAt?: number;
  /** Why the most recent attempt failed, if it did; cleared by a success. */
  lastError?: string;
  lastErrorAt?: number;
  /** Failed attempts in a row. */
  failures?: number;
}

export class AgendaStore {
  private filePath: string | null;
  private entries = new Map<string, AgendaEntry>();

  constructor(filePath: string | null) {
    this.filePath = filePath;
  }

  async load(): Promise<void> {
    if (!this.filePath) return;
    try {
      const raw   = await readFile(this.filePath, 'utf-8');
      const items = JSON.parse(raw) as AgendaEntry[];
      this.entries.clear();
      for (const e of items) this.entries.set(e.id, e);
    } catch { /* file doesn't exist yet — start empty */ }
  }

  async switchTo(filePath: string): Promise<void> {
    this.filePath = filePath;
    this.entries.clear();
    await this.load();
  }

  list(agentName?: string): AgendaEntry[] {
    const all = [...this.entries.values()];
    return agentName ? all.filter(e => e.agentName === agentName) : all;
  }

  listDue(): AgendaEntry[] {
    const now = Date.now();
    return [...this.entries.values()].filter(e => e.enabled && e.nextRunAt <= now);
  }

  get(id: string): AgendaEntry | undefined {
    return this.entries.get(id);
  }

  async add(data: {
    agentName: string;
    label: string;
    description: string;
    intervalSeconds: number | null;
    delaySeconds?: number;
    type?: ScheduledActionType;
    mcpToolCall?: McpToolCallSpec;
    actionId?: string;
  }): Promise<AgendaEntry> {
    // Deduplicate: if an entry with the same agent+label already exists, update it
    const labelKey = data.label.trim().toLowerCase();
    const existing = [...this.entries.values()].find(
      e => e.agentName === data.agentName && e.label.trim().toLowerCase() === labelKey,
    );
    if (existing) {
      const delay = data.delaySeconds ?? (data.intervalSeconds ?? 60);
      Object.assign(existing, {
        description:     data.description,
        intervalSeconds: data.intervalSeconds,
        nextRunAt:       Date.now() + delay * 1000,
        enabled:         true,
        type:            data.type,
        mcpToolCall:     data.mcpToolCall,
        ...(data.actionId && { actionId: data.actionId }),
      });
      await this.save();
      return existing;
    }

    const delay = data.delaySeconds ?? (data.intervalSeconds ?? 60);
    const entry: AgendaEntry = {
      id:              uuidv4(),
      agentName:       data.agentName,
      label:           data.label,
      description:     data.description,
      intervalSeconds: data.intervalSeconds,
      nextRunAt:       Date.now() + delay * 1000,
      enabled:         true,
      createdAt:       new Date().toISOString(),
      ...(data.type        && { type: data.type }),
      ...(data.mcpToolCall && { mcpToolCall: data.mcpToolCall }),
      ...(data.actionId    && { actionId: data.actionId }),
    };
    this.entries.set(entry.id, entry);
    await this.save();
    return entry;
  }

  async update(id: string, patch: Partial<AgendaEntry>): Promise<AgendaEntry | undefined> {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    const { id: _id, agentName: _agent, createdAt: _created, ...editable } = patch;
    // A new interval starts counting from now; otherwise an entry moved from
    // daily to hourly would still wait out the rest of its day.
    const rescheduled = editable.intervalSeconds !== undefined && editable.intervalSeconds !== entry.intervalSeconds;
    Object.assign(entry, editable);
    if (rescheduled) entry.nextRunAt = Date.now() + (entry.intervalSeconds ?? 60) * 1000;
    await this.save();
    return entry;
  }

  async remove(id: string): Promise<boolean> {
    const deleted = this.entries.delete(id);
    if (deleted) await this.save();
    return deleted;
  }

  private async save(): Promise<void> {
    if (!this.filePath) return;
    await writeFile(this.filePath, JSON.stringify(this.list(), null, 2), 'utf-8');
  }
}
