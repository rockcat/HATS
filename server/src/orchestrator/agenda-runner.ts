import { AgendaEntry, AgendaStore } from '../api/agenda-store.js';
import { MCPRegistry } from '../mcp/mcp-registry.js';
import { TeamMessage } from './types.js';
import { buildMessage } from './orchestrator-utils.js';
import { log } from '../../../packages/core/src/logger.js';

/** Quick retries before a failing entry falls back to its normal interval. */
const QUICK_RETRIES = 3;

/**
 * What to record when an entry fails. The first few failures retry on the next
 * check — usually a server that has not finished connecting. After that it
 * waits its normal interval, so a broken entry does not fail every minute
 * forever; a one-off that keeps failing is switched off.
 */
export function failureUpdate(entry: AgendaEntry, message: string, now: number, checkIntervalMs: number): Partial<AgendaEntry> {
  const failures = (entry.failures ?? 0) + 1;
  const base = { lastError: message, lastErrorAt: now, failures };
  if (failures < QUICK_RETRIES) return { ...base, nextRunAt: now + checkIntervalMs };
  if (!entry.intervalSeconds) return { ...base, enabled: false };
  return { ...base, nextRunAt: now + entry.intervalSeconds * 1000 };
}

export class AgendaRunner {
  private store: AgendaStore;
  private deliverMessage: (agentName: string, msg: TeamMessage) => Promise<void>;
  private mcp: MCPRegistry | null;
  private getPersonalMcp: (agentName: string) => MCPRegistry | null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly checkIntervalMs: number;

  constructor(
    store: AgendaStore,
    deliverMessage: (agentName: string, msg: TeamMessage) => Promise<void>,
    mcp: MCPRegistry | null = null,
    getPersonalMcp: (agentName: string) => MCPRegistry | null = () => null,
    checkIntervalMs = 60_000,
  ) {
    this.store = store;
    this.deliverMessage = deliverMessage;
    this.mcp = mcp;
    this.getPersonalMcp = getPersonalMcp;
    this.checkIntervalMs = checkIntervalMs;
  }

  start(): void {
    if (this.timer) return;
    // Every enabled task fires once at startup — but on the first check, not
    // immediately. The runner starts before the team is restored and before
    // personal MCP servers connect, so an immediate run reached no agent and
    // no tools, failed, and was not tried again for a whole interval.
    let first = true;
    this.timer = setInterval(() => { void this.tick(first); first = false; }, this.checkIntervalMs);
    log.info(`[Agenda] Runner started — checking every ${this.checkIntervalMs / 1000}s`);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  async tick(fireAll = false): Promise<void> {
    const due = fireAll
      ? this.store.list().filter(e => e.enabled)
      : this.store.listDue();
    if (due.length === 0) return;
    const now = Date.now();
    for (const entry of due) {
      try {
        log.info(`[Agenda] Firing "${entry.label}" for ${entry.agentName}`);
        if (entry.type === 'mcp_tool_call' && entry.mcpToolCall) {
          await this.fireMcpToolCall(entry);
        } else {
          await this.firePrompt(entry);
        }
        const done = { lastRunAt: now, lastError: undefined, lastErrorAt: undefined, failures: 0 };
        if (entry.intervalSeconds) {
          await this.store.update(entry.id, { ...done, nextRunAt: now + entry.intervalSeconds * 1000 });
        } else {
          await this.store.update(entry.id, { ...done, enabled: false });
        }
      } catch (err) {
        const message = (err as Error).message;
        log.error(`[Agenda] "${entry.label}" for ${entry.agentName} failed: ${message}`);
        await this.store.update(entry.id, failureUpdate(entry, message, now, this.checkIntervalMs));
      }
    }
  }

  private async firePrompt(entry: AgendaEntry): Promise<void> {
    const repeatNote = entry.intervalSeconds
      ? `This task runs automatically every ${Math.round(entry.intervalSeconds / 60)} minute(s) and has just fired. Do NOT schedule it again — just do it now.`
      : 'This is a one-off task. Do NOT schedule it again — just do it now.';
    const content = `Do this now — ${entry.label}:\n\n${entry.description}\n\n(${repeatNote})\n\nIf there is nothing to do right now, call disengage_conversation immediately and produce no text response.`;
    const msg = buildMessage('human', entry.agentName, 'direct', content, { isScheduled: true });
    await this.deliverMessage(entry.agentName, msg);
  }

  private async fireMcpToolCall(entry: AgendaEntry): Promise<void> {
    const spec = entry.mcpToolCall!;
    // Resolve registry: personal MCP takes priority if specified, else shared
    const registry = spec.personalMcpAgentName
      ? (this.getPersonalMcp(spec.personalMcpAgentName) ?? this.mcp)
      : this.mcp;
    if (!registry) throw new Error('no MCP servers are running');
    // A failed call is a failed run: thrown so tick() retries it soon rather
    // than recording it as done.
    const result = await registry.callTool(spec.toolName, spec.args);

    let shouldMessage = true;
    if (spec.condition.trim()) {
      try {
        // eslint-disable-next-line no-new-func
        const fn = new Function('result', `return !!(${spec.condition})`);
        shouldMessage = fn(result) as boolean;
      } catch (err) {
        log.warn(`[Agenda] Condition eval error for "${entry.label}":`, (err as Error).message);
        shouldMessage = false;
      }
    }

    if (!shouldMessage) {
      log.info(`[Agenda] Condition not met for "${entry.label}" — skipping agent message`);
      return;
    }

    const text = spec.messageTemplate.replace(/\$\{result\}/g, result);
    const msg = buildMessage('human', entry.agentName, 'direct', text, { isScheduled: true });
    await this.deliverMessage(entry.agentName, msg);
  }
}
