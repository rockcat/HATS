import { v4 as uuidv4 } from 'uuid';
import { readFile, writeFile } from 'fs/promises';
import { McpToolCallSpec, ScheduledActionType } from '../store/team-snapshot.js';
import type { PromptMode } from '../../../packages/core/src/prompt/types.js';
import { nextCronRun, cronError } from '../../../packages/core/src/schedule/cron.js';

/** How an entry repeats: at the times a cron expression names, every so many seconds, or not at all. */
export interface Repeat {
  intervalSeconds: number | null;
  /** When set, this decides when it runs and the interval is ignored. */
  cron?: string;
}

/** When a repeating entry next runs after `now`; null when it does not repeat. */
export function nextRunAfter(repeat: Repeat, now: number): number | null {
  if (repeat.cron) return nextCronRun(repeat.cron, now);
  return repeat.intervalSeconds ? now + repeat.intervalSeconds * 1000 : null;
}

/**
 * The repeat a request asks for. A cron expression wins over an interval;
 * a bad one throws, saying what is wrong with it.
 */
export function repeatFromRequest(body: { intervalMinutes?: number | null; cron?: string | null }): Repeat {
  const cron = body.cron?.trim();
  if (cron) {
    const problem = cronError(cron);
    if (problem) throw new Error(`Bad cron expression: ${problem}`);
    return { intervalSeconds: null, cron };
  }
  const mins = body.intervalMinutes;
  return { intervalSeconds: mins && mins > 0 ? Math.round(mins * 60) : null };
}

/** The prompt a request asks for; anything else, '' or null among it, means the agent's own setting. */
export function promptModeFrom(value: unknown): PromptMode | undefined {
  return value === 'full' || value === 'condensed' ? value : undefined;
}

/** When a new or rescheduled entry first runs: its first cron time, else after a delay. */
function firstRun(repeat: Repeat, delaySeconds: number | undefined, now: number): number {
  if (repeat.cron) return nextCronRun(repeat.cron, now) ?? now;
  return now + (delaySeconds ?? repeat.intervalSeconds ?? 60) * 1000;
}

export interface AgendaEntry {
  id: string;
  agentName: string;
  label: string;
  description: string;
  intervalSeconds: number | null;
  /** Run at these times instead of on an interval — see packages/core/src/schedule/cron.ts. */
  cron?: string;
  nextRunAt: number;
  enabled: boolean;
  createdAt: string;
  type?: ScheduledActionType;
  mcpToolCall?: McpToolCallSpec;
  /** The prompt the agent answers this with; its own setting when absent. */
  promptMode?: PromptMode;
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
    cron?: string;
    delaySeconds?: number;
    type?: ScheduledActionType;
    mcpToolCall?: McpToolCallSpec;
    promptMode?: PromptMode;
    actionId?: string;
  }): Promise<AgendaEntry> {
    // Deduplicate: if an entry with the same agent+label already exists, update it
    const labelKey = data.label.trim().toLowerCase();
    const existing = [...this.entries.values()].find(
      e => e.agentName === data.agentName && e.label.trim().toLowerCase() === labelKey,
    );
    if (existing) {
      Object.assign(existing, {
        description:     data.description,
        intervalSeconds: data.cron ? null : data.intervalSeconds,
        cron:            data.cron || undefined,
        nextRunAt:       firstRun(data, data.delaySeconds, Date.now()),
        enabled:         true,
        type:            data.type,
        mcpToolCall:     data.mcpToolCall,
        promptMode:      data.promptMode,
        ...(data.actionId && { actionId: data.actionId }),
      });
      await this.save();
      return existing;
    }

    const entry: AgendaEntry = {
      id:              uuidv4(),
      agentName:       data.agentName,
      label:           data.label,
      description:     data.description,
      intervalSeconds: data.cron ? null : data.intervalSeconds,
      ...(data.cron    && { cron: data.cron }),
      nextRunAt:       firstRun(data, data.delaySeconds, Date.now()),
      enabled:         true,
      createdAt:       new Date().toISOString(),
      ...(data.type        && { type: data.type }),
      ...(data.mcpToolCall && { mcpToolCall: data.mcpToolCall }),
      ...(data.promptMode  && { promptMode: data.promptMode }),
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
    // A new interval starts counting from now, and a new cron expression runs
    // at its next time; otherwise an entry moved from daily to hourly would
    // still wait out the rest of its day. Null or '' clears the cron.
    const rescheduled = (editable.intervalSeconds !== undefined && editable.intervalSeconds !== entry.intervalSeconds)
      || ('cron' in editable && (editable.cron || undefined) !== entry.cron);
    Object.assign(entry, editable);
    if (!entry.cron) delete entry.cron;
    else entry.intervalSeconds = null;
    if (rescheduled) entry.nextRunAt = firstRun(entry, undefined, Date.now());
    await this.save();
    return entry;
  }

  async remove(id: string): Promise<boolean> {
    const deleted = this.entries.delete(id);
    if (deleted) await this.save();
    return deleted;
  }

  /** Remove every entry for an agent that is gone. Returns what was removed. */
  removeAgent(agentName: string): Promise<AgendaEntry[]> {
    return this.removeWhere(e => e.agentName === agentName);
  }

  /**
   * Remove the entries of every agent not named here — left behind by agents
   * deleted before deleting one cleared its agenda. Returns what was removed.
   */
  keepOnlyAgents(agentNames: string[]): Promise<AgendaEntry[]> {
    const keep = new Set(agentNames);
    return this.removeWhere(e => !keep.has(e.agentName));
  }

  /**
   * Move an agent's entries to its new name, and point tool calls that used
   * its own MCP servers at them under that name. Returns how many changed.
   */
  async renameAgent(oldName: string, newName: string): Promise<number> {
    let changed = 0;
    for (const e of this.entries.values()) {
      const owned = e.agentName === oldName;
      const usesItsMcp = e.mcpToolCall?.personalMcpAgentName === oldName;
      if (owned) e.agentName = newName;
      if (usesItsMcp) e.mcpToolCall = { ...e.mcpToolCall!, personalMcpAgentName: newName };
      if (owned || usesItsMcp) changed++;
    }
    if (changed) await this.save();
    return changed;
  }

  private async removeWhere(match: (e: AgendaEntry) => boolean): Promise<AgendaEntry[]> {
    const removed = this.list().filter(match);
    for (const e of removed) this.entries.delete(e.id);
    if (removed.length) await this.save();
    return removed;
  }

  private async save(): Promise<void> {
    if (!this.filePath) return;
    await writeFile(this.filePath, JSON.stringify(this.list(), null, 2), 'utf-8');
  }
}
