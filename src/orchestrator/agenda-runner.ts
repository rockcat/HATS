import { AgendaEntry, AgendaStore } from '../api/agenda-store.js';
import { MCPRegistry } from '../mcp/mcp-registry.js';
import { TeamMessage } from './types.js';
import { buildMessage } from './orchestrator-utils.js';
import { log } from '../util/logger.js';

export class AgendaRunner {
  private store: AgendaStore;
  private deliverMessage: (agentName: string, msg: TeamMessage) => Promise<void>;
  private mcp: MCPRegistry | null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly checkIntervalMs: number;

  constructor(
    store: AgendaStore,
    deliverMessage: (agentName: string, msg: TeamMessage) => Promise<void>,
    mcp: MCPRegistry | null = null,
    checkIntervalMs = 60_000,
  ) {
    this.store = store;
    this.deliverMessage = deliverMessage;
    this.mcp = mcp;
    this.checkIntervalMs = checkIntervalMs;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.checkIntervalMs);
    log.info(`[Agenda] Runner started — checking every ${this.checkIntervalMs / 1000}s`);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  async tick(): Promise<void> {
    const due = this.store.listDue();
    if (due.length === 0) return;
    const now = Date.now();
    for (const entry of due) {
      try {
        log.info(`[Agenda] Firing "${entry.label}" for ${entry.agentName}`);
        if (entry.type === 'mcp_tool_call' && entry.mcpToolCall && this.mcp) {
          await this.fireMcpToolCall(entry);
        } else {
          await this.firePrompt(entry);
        }
        if (entry.intervalSeconds) {
          await this.store.update(entry.id, { nextRunAt: now + entry.intervalSeconds * 1000 });
        } else {
          await this.store.update(entry.id, { enabled: false });
        }
      } catch (err) {
        log.error(`[Agenda] Error firing action ${entry.id}:`, (err as Error).message);
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
    let result: string;
    try {
      result = await this.mcp!.callTool(spec.toolName, spec.args);
    } catch (err) {
      log.error(`[Agenda] MCP tool call failed for "${entry.label}":`, (err as Error).message);
      return;
    }

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
