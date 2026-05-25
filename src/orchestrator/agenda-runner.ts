import { AgendaStore } from '../api/agenda-store.js';
import { log } from '../util/logger.js';

export class AgendaRunner {
  private store: AgendaStore;
  private sendMessage: (agentName: string, content: string) => Promise<void>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly checkIntervalMs: number;

  constructor(
    store: AgendaStore,
    sendMessage: (agentName: string, content: string) => Promise<void>,
    checkIntervalMs = 60_000,
  ) {
    this.store = store;
    this.sendMessage = sendMessage;
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
        const repeatNote = entry.intervalSeconds
          ? `This task runs automatically every ${Math.round(entry.intervalSeconds / 60)} minute(s) and has just fired. Do NOT schedule it again — just do it now.`
          : 'This is a one-off task. Do NOT schedule it again — just do it now.';
        const content = `Do this now — ${entry.label}:\n\n${entry.description}\n\n(${repeatNote})`;
        await this.sendMessage(entry.agentName, content);
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
}
