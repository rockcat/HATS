import { spawn } from 'child_process';
import { writeFile, mkdir, readFile } from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { log } from '../util/logger.js';
import { HatType } from '../hats/types.js';
import { AIProvider, ToolDefinition } from '../providers/types.js';
import { TeamMessage } from '../orchestrator/types.js';
import { Semaphore } from '../providers/semaphore.js';
import { AgentConfig, AgentMessage, AgentState, ExternalAgentEndpoint, ToolExecutor, ResponseHandler } from './types.js';
import { IAgent } from './iagent.js';

type HistoryEntryLike = {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: Date | string;
  toolCalls?: unknown;
  toolCallId?: string;
  toolName?: string;
};

type PendingEntry = { message: TeamMessage; timer: ReturnType<typeof setTimeout> | null };

/** Stub so config.provider.name returns 'external' without a real LLM provider. */
export const EXTERNAL_PROVIDER: AIProvider = {
  name: 'external',
  pricingPageUrl: '',
  complete: async () => { throw new Error('ExternalAgent does not use a local LLM provider'); },
};

/**
 * An agent whose processing is delegated to an external HTTP service.
 * The service receives messages via POST and returns responses either
 * synchronously in the response body or via a callback POST.
 *
 * External agent HTTP contract (sync mode — default):
 *   POST {endpoint.url}
 *   Authorization: {endpoint.authHeader}   (if set)
 *   { messageId, agentId, agentName, from, type, content, taskId }
 *   → 200 { response: "..." }
 *
 * Callback mode:
 *   Same POST but with { ...payload, callbackUrl }
 *   → 202 Accepted
 *   Then external service POSTs: { messageId, response } to callbackUrl
 */
export class ExternalAgent implements IAgent {
  readonly id: string;
  readonly config: AgentConfig;

  private _state: AgentState = AgentState.Idle;
  private responseHandler: ResponseHandler | null = null;
  private pendingMessages = new Map<string, PendingEntry>();
  /** Conversation history for subprocess mode — allows multi-turn exchange and UI display. */
  private subprocessHistory: Array<{ role: 'human' | 'assistant'; content: string; ts: Date }> = [];

  constructor(config: AgentConfig) {
    this.id = config.id ?? uuidv4();
    this.config = { ...config, provider: config.provider ?? EXTERNAL_PROVIDER };
  }

  get name(): string { return this.config.identity.name; }
  get hatType(): HatType[] { return this.config.hatType; }
  get state(): AgentState { return this._state; }

  // ── Wiring ──────────────────────────────────────────────────────────────────

  setResponseHandler(handler: ResponseHandler): void { this.responseHandler = handler; }
  setToolExecutor(_executor: ToolExecutor): void {}
  setExtraToolsProvider(_fn: () => ToolDefinition[]): void {}
  setLLMSemaphore(_semaphore: Semaphore): void {}
  setTelemetryRecorder(_fn: unknown): void {}

  // ── Inbox ───────────────────────────────────────────────────────────────────

  receive(message: TeamMessage): void {
    if (this._state === AgentState.Idle || this._state === AgentState.Waiting) {
      this._state = AgentState.Working;
    }
    this.sendToExternal(message).catch((err: Error) => {
      log.error(`[ExternalAgent:${this.name}] delivery failed:`, err.message);
      this.resolvePending();
    });
  }

  interrupt(message: TeamMessage): void {
    this.receive(message);
  }

  markHelpReceived(): void {
    if (this._state === AgentState.WaitingForHelp) this._state = AgentState.Idle;
  }

  markBlocked(): void {
    this._state = AgentState.WaitingForHelp;
  }

  markTaskComplete(): void {
    this._state = AgentState.Waiting;
  }

  markDiscussionEnded(): void {
    if (this._state === AgentState.InDiscussion) this._state = AgentState.Idle;
  }

  stop(): void {
    for (const { timer } of this.pendingMessages.values()) {
      if (timer) clearTimeout(timer);
    }
    this.pendingMessages.clear();
    this._state = AgentState.Idle;
  }

  private resolvePending(): void {
    if (this.pendingMessages.size === 0) this._state = AgentState.Idle;
  }

  // ── External HTTP / Subprocess ──────────────────────────────────────────────

  private async sendToExternal(message: TeamMessage): Promise<void> {
    const endpoint = this.config.externalEndpoint;
    if (!endpoint) {
      log.error(`[ExternalAgent:${this.name}] no externalEndpoint configured`);
      this.resolvePending();
      return;
    }

    if (endpoint.mode === 'subprocess') {
      await this.sendToSubprocess(message, endpoint);
      return;
    }

    await this.sendToHttp(message, endpoint);
  }

  private async sendToSubprocess(message: TeamMessage, endpoint: ExternalAgentEndpoint): Promise<void> {
    const command = endpoint.command;
    if (!command) {
      log.error(`[ExternalAgent:${this.name}] subprocess mode requires 'command'`);
      this.resolvePending();
      return;
    }

    const timeoutMs = endpoint.timeoutMs ?? 120_000;
    const inputMode = endpoint.inputMode ?? 'stdin';
    const cwd = await this.subprocessWorkDir();

    // Session resumption: load saved session_id from disk so the subprocess can
    // resume its prior conversation (including tool call history) across server restarts.
    const sessionFile = endpoint.captureSessionId ? path.join(cwd, '.session_id') : null;
    let sessionId: string | null = null;
    if (sessionFile) {
      sessionId = await readFile(sessionFile, 'utf-8').then(s => s.trim() || null).catch(() => null);
    }

    // Build args: inject --output-format json (to get session_id back) and --resume if continuing.
    let args = [...(endpoint.args ?? [])];
    if (endpoint.captureSessionId) {
      args = [...args, '--output-format', 'json'];
      if (sessionId) args = [...args, '--resume', sessionId];
    }

    // Inject --add-dir flags so the subprocess can access project directories without
    // requiring --dangerously-skip-permissions.
    if (endpoint.addDirs?.length && this.config.projectDir) {
      for (const d of endpoint.addDirs) {
        const resolved = d === 'outputs'
          ? path.join(this.config.projectDir, 'outputs')
          : this.config.projectDir;
        args = [...args, '--add-dir', resolved];
      }
    }

    // When resuming a real Claude session, the subprocess already has full history — send only
    // the current message. Without a session, prepend conversation history so Claude has context.
    const stdinText = (inputMode === 'stdin' && !sessionId)
      ? this.buildSubprocessInput(message.content, inputMode)
      : message.content;
    const finalArgs = inputMode === 'arg' ? [...args, stdinText] : args;

    log.info(`[ExternalAgent:${this.name}] spawn ${command} in ${cwd}${sessionId ? ` (resume ${sessionId.slice(0, 8)}…)` : ''}`);
    const rawOutput = await new Promise<string>((resolve, reject) => {
      const child = spawn(command, finalArgs, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`subprocess timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      if (inputMode === 'stdin') {
        child.stdin.write(stdinText);
        child.stdin.end();
      }

      child.on('close', (code) => {
        clearTimeout(timer);
        if (stderrChunks.length > 0) {
          log.warn(`[ExternalAgent:${this.name}] stderr: ${Buffer.concat(stderrChunks).toString('utf-8').slice(0, 500)}`);
        }
        if (code !== 0) {
          reject(new Error(`subprocess exited with code ${code}`));
        } else {
          resolve(Buffer.concat(stdoutChunks).toString('utf-8').trim());
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    }).catch((err: Error) => {
      log.error(`[ExternalAgent:${this.name}] subprocess error: ${err.message}`);
      return '';
    });

    // Parse JSON output when captureSessionId is set; save the session_id for next call.
    let response = rawOutput;
    if (endpoint.captureSessionId && rawOutput) {
      try {
        const parsed = JSON.parse(rawOutput) as { result?: string; session_id?: string; is_error?: boolean };
        response = parsed.result ?? rawOutput;
        if (parsed.session_id && sessionFile) {
          await writeFile(sessionFile, parsed.session_id, 'utf-8');
          log.info(`[ExternalAgent:${this.name}] session_id saved: ${parsed.session_id.slice(0, 8)}…`);
        }
      } catch {
        log.warn(`[ExternalAgent:${this.name}] output was not JSON — using raw text`);
      }
    }

    this.subprocessHistory.push({ role: 'human', content: message.content, ts: new Date() });
    if (response) this.subprocessHistory.push({ role: 'assistant', content: response, ts: new Date() });

    await this.dispatchResponse(message, response);
    this.resolvePending();
  }

  /**
   * Builds the full text to pass to the subprocess. When there is prior
   * conversation history the prior turns are prepended so Claude can answer
   * follow-up messages with full context.
   */
  private buildSubprocessInput(currentContent: string, inputMode: string): string {
    if (inputMode !== 'stdin' || this.subprocessHistory.length === 0) {
      return currentContent;
    }
    const lines: string[] = ['<conversation_history>'];
    for (const turn of this.subprocessHistory) {
      lines.push(turn.role === 'human' ? `Human: ${turn.content}` : `Assistant: ${turn.content}`);
    }
    lines.push('</conversation_history>', '', currentContent);
    return lines.join('\n');
  }

  private async sendToHttp(message: TeamMessage, endpoint: ExternalAgentEndpoint): Promise<void> {
    const messageId = uuidv4();
    const timeoutMs = endpoint.timeoutMs ?? 120_000;
    const isCallback = endpoint.mode === 'callback';

    const payload: Record<string, unknown> = {
      messageId,
      agentId: this.id,
      agentName: this.name,
      from: message.from,
      type: message.type,
      content: message.content,
      taskId: message.taskId ?? null,
    };
    if (isCallback && endpoint.callbackUrl) {
      payload.callbackUrl = endpoint.callbackUrl;
    }

    if (isCallback) {
      const timer = setTimeout(() => {
        if (this.pendingMessages.has(messageId)) {
          log.warn(`[ExternalAgent:${this.name}] callback timeout for ${messageId}`);
          this.pendingMessages.delete(messageId);
          this.resolvePending();
        }
      }, timeoutMs);
      this.pendingMessages.set(messageId, { message, timer });
    }

    let res: Response;
    try {
      res = await fetch(endpoint.url!, {
        method: 'POST',
        headers: this.buildHeaders(endpoint),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      log.error(`[ExternalAgent:${this.name}] fetch error:`, (err as Error).message);
      this.cancelPending(messageId);
      return;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      log.error(`[ExternalAgent:${this.name}] HTTP ${res.status}: ${text.slice(0, 200)}`);
      this.cancelPending(messageId);
      return;
    }

    if (!isCallback) {
      try {
        const body = await res.json() as { response?: string };
        await this.dispatchResponse(message, body.response ?? '');
      } catch (err) {
        log.error(`[ExternalAgent:${this.name}] failed to parse response:`, (err as Error).message);
      }
      this.resolvePending();
    }
    // callback mode: resolution happens in handleExternalCallback
  }

  async handleExternalCallback(messageId: string, response: string): Promise<void> {
    const pending = this.pendingMessages.get(messageId);
    if (!pending) {
      log.warn(`[ExternalAgent:${this.name}] callback for unknown messageId ${messageId}`);
      return;
    }
    if (pending.timer) clearTimeout(pending.timer);
    this.pendingMessages.delete(messageId);
    this.resolvePending();
    await this.dispatchResponse(pending.message, response);
  }

  private async dispatchResponse(originalMessage: TeamMessage, response: string): Promise<void> {
    if (this.responseHandler) {
      await this.responseHandler(this.name, originalMessage, response);
    }
  }

  private cancelPending(messageId: string): void {
    const entry = this.pendingMessages.get(messageId);
    if (entry) {
      if (entry.timer) clearTimeout(entry.timer);
      this.pendingMessages.delete(messageId);
    }
    this.resolvePending();
  }

  /** Returns (and creates) the working directory for this subprocess agent.
   *  Placed under <projectDir>/outputs/<slug>/ so the agent can see sibling
   *  agents' output files in the parent outputs/ folder. */
  private async subprocessWorkDir(): Promise<string> {
    const slug = this.name.toLowerCase().replace(/\s+/g, '_');
    const outputsDir = path.join(this.config.projectDir ?? process.cwd(), 'outputs');
    const dir = path.join(outputsDir, slug);
    await mkdir(dir, { recursive: true });
    await this.ensureClaudeMd(dir, outputsDir);
    return dir;
  }

  private async ensureClaudeMd(dir: string, outputsDir: string): Promise<void> {
    const filePath = path.join(dir, 'CLAUDE.md');
    const agentName = this.name;
    const content = [
      '# HATS Agent Context',
      '',
      `You are **${agentName}**, an AI agent operating inside HATS (Human Agent Teaming System).`,
      'You receive tasks via stdin through `claude -p` and your stdout is captured as your response.',
      '',
      '## Working directory',
      `Your working directory is: \`${dir}\``,
      'This is where you create and edit your own files.',
      'Do **not** touch files outside this directory unless explicitly instructed.',
      'Ignore any parent-directory CLAUDE.md files — this file defines your context.',
      '',
      '## Shared outputs folder',
      `The shared outputs folder is: \`${outputsDir}\``,
      'Other HATS agents write their output files into sub-folders here.',
      'You can **read** files from sibling folders to see what other agents have produced.',
      'Write your own output into **your** working directory above.',
      '',
      '## Behaviour',
      '- Complete tasks directly and autonomously.',
      '- Do **not** ask for confirmation before proceeding.',
      '- Do **not** ask clarifying questions — use your best judgement and state any assumptions.',
      '- Do **not** prompt for user input; you are running non-interactively.',
      '- When you finish, summarise what you did and the outcome.',
      '',
      '## Context',
      '- Other HATS agents (human and AI) may send you follow-up messages.',
      '- Prior conversation turns are included when this is a first-time session.',
    ].join('\n');

    await writeFile(filePath, content, 'utf-8');
  }

  private buildHeaders(endpoint: ExternalAgentEndpoint): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (endpoint.authHeader) headers['Authorization'] = endpoint.authHeader;
    return headers;
  }

  // ── Meeting turn ─────────────────────────────────────────────────────────────

  async meetingTurn(transcript: string, _extraTools: ToolDefinition[] = []): Promise<string> {
    const endpoint = this.config.externalEndpoint;
    if (!endpoint) return '';

    if (endpoint.mode === 'subprocess') {
      const fakeMessage: TeamMessage = { id: 'meeting-turn', ts: new Date().toISOString(), from: 'meeting', to: this.name, type: 'meeting_turn', content: transcript };
      let result = '';
      const original = this.responseHandler;
      this.responseHandler = async (_name, _msg, response) => { result = response; };
      await this.sendToSubprocess(fakeMessage, endpoint);
      this.responseHandler = original;
      return result;
    }

    const timeoutMs = endpoint.timeoutMs ?? 60_000;
    try {
      const res = await fetch(endpoint.url!, {
        method: 'POST',
        headers: this.buildHeaders(endpoint),
        body: JSON.stringify({
          messageId: uuidv4(),
          agentId: this.id,
          agentName: this.name,
          type: 'meeting_turn',
          content: transcript,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return '';
      const body = await res.json() as { response?: string };
      return body.response ?? '';
    } catch {
      return '';
    }
  }

  // ── Config mutations ─────────────────────────────────────────────────────────

  rename(newName: string): void { this.config.identity.name = newName; }
  setProvider(provider: AIProvider, model: string): void { this.config.provider = provider; this.config.model = model; }
  setHat(hatTypes: HatType[]): void { this.config.hatType = hatTypes; }
  updateTeamContext(teamContext: string): void { this.config.teamContext = teamContext; }
  updateProjectDir(projectDir: string | null): void {
    this.config.projectDir = projectDir ?? undefined;
    if (projectDir && this.config.externalEndpoint?.mode === 'subprocess') {
      this.subprocessWorkDir().catch((err: Error) =>
        log.warn(`[ExternalAgent:${this.name}] could not prepare work dir: ${err.message}`)
      );
    }
  }
  updateProjectGoal(goal: string | null): void { this.config.projectGoal = goal ?? undefined; }
  setSpecialisation(s: string | undefined): void { this.config.identity.specialisation = s; }
  setIdentity(vd: string | undefined, bs: string | undefined): void {
    if (vd !== undefined) this.config.identity.visualDescription = vd;
    if (bs !== undefined) this.config.identity.backstory = bs;
  }
  setAvatar(a: string | undefined): void { this.config.identity.avatar = a; }
  setBackground(b: string | undefined): void { (this.config.identity as unknown as Record<string, unknown>)['background'] = b; }
  setVoice(v: string | undefined, sn: string | undefined): void {
    this.config.identity.voice = v;
    this.config.identity.speakerName = sn;
  }
  setMaxContextTokens(_v: number | undefined): void {}
  setMaxCostPerHour(_v: number | undefined): void {}

  toJSON(): object {
    return { id: this.id, name: this.name, hatType: this.hatType, state: this._state, type: 'external' };
  }

  // ── History (external agents have no local history) ──────────────────────────

  getHistory(): AgentMessage[] { return this.subprocessHistoryAsMessages(); }
  getAllThreadHistories(): Record<string, AgentMessage[]> { return { general: this.subprocessHistoryAsMessages() }; }
  getThreadSummary(): Record<string, number> { return {}; }
  getThreadHistory(_thread: string): AgentMessage[] { return this.subprocessHistoryAsMessages(); }
  getActiveThreadKey(): string { return 'general'; }
  getHourlyCost(): number { return 0; }
  isCostIdled(): boolean { return false; }
  clearAllThreads(): void { this.subprocessHistory = []; }

  setHistory(history: HistoryEntryLike[]): void {
    this.subprocessHistory = history
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({
        role: m.role === 'user' ? 'human' : 'assistant' as 'human' | 'assistant',
        content: m.content,
        ts: m.timestamp instanceof Date ? m.timestamp : new Date(m.timestamp),
      }));
  }

  setAllThreadHistories(allThreads: Record<string, HistoryEntryLike[]>): void {
    this.setHistory(allThreads['general'] ?? []);
  }

  private subprocessHistoryAsMessages(): AgentMessage[] {
    return this.subprocessHistory.map(h => ({
      role: h.role === 'human' ? 'user' : 'assistant',
      content: h.content,
      timestamp: h.ts,
    }));
  }
}
