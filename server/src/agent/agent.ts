import { v4 as uuidv4 } from 'uuid';
import { log } from '../../../packages/core/src/logger.js';
import { HatType } from '../../../packages/core/src/hats/types.js';
import { generateSystemPrompt } from '../../../packages/core/src/prompt/generator.js';
import type { PromptMode, SystemPrompt } from '../../../packages/core/src/prompt/types.js';
import { promptContextFor, type PromptOverrides } from './prompt-context.js';
import { AIProvider, CompletionRequest, Message, ProviderError, ToolCall, type ToolOutcome } from '../providers/types.js';
import { getToolsForHat, getAllToolsForHat } from '../../../packages/core/src/tools/definitions.js';
import { buildToolRegistry, searchTools, getTool, ToolRegistry } from '../tools/tool-search.js';
import { TeamMessage } from '../orchestrator/types.js';
import { AgentConfig, AgentMessage, AgentState, AgentEvent, ToolExecutor, ResponseHandler } from './types.js';
import { IAgent } from './iagent.js';
import { transition } from './state-machine.js';
import { Semaphore } from '../providers/semaphore.js';
import { calcCost } from '../providers/pricing.js';
import { contextWindow, sanitizeHistory, toProviderMessage, formatIncomingMessage } from './agent-utils.js';

type TelemetryRecorder = (entry: {
  agent: string; provider: string; model: string;
  promptLength: number; inputTokens: number; outputTokens: number; cost: number;
}) => void;

const MAX_TOOL_ROUNDS      = 10; // prevent infinite tool loops
const MAX_HISTORY_MESSAGES = 20;  // what is SENT when no maxContextTokens is set
// What a thread KEEPS. Generous, because forgetting is the failure that
// matters, but bounded: threads are serialised into team-state.json on every
// save. The event log keeps everything regardless.
const MAX_STORED_MESSAGES = 500;
// Scheduled runs are kept in a thread of their own so they can be seen without
// cluttering — or feeding into — the agent's real conversations.
export const SCHEDULED_THREAD = 'scheduled';
const MAX_SCHEDULED_MESSAGES = 200;
/** Team news an agent holds until its next turn; older items are dropped. */
const MAX_NOTICES = 10;

export class Agent implements IAgent {
  readonly id: string;
  readonly config: AgentConfig;
  private _state: AgentState;
  private systemPrompt: string;
  private threads = new Map<string, AgentMessage[]>();
  /**
   * When each message was first said, keyed by the provider message object.
   *
   * Provider messages carry no timestamp, so persisting a turn used to stamp
   * every message in the thread with new Date() — a thread restored from
   * disk showed all of its history as having happened at the last save.
   */
  private stamps = new WeakMap<Message, Date>();
  private activeTaskId: string | null = null;

  private get activeThreadKey(): string { return this.activeTaskId ?? 'general'; }

  private get conversationHistory(): AgentMessage[] {
    const key = this.activeThreadKey;
    if (!this.threads.has(key)) this.threads.set(key, []);
    return this.threads.get(key)!;
  }

  private set conversationHistory(messages: AgentMessage[]) {
    this.threads.set(this.activeThreadKey, messages);
  }
  private inbox: TeamMessage[] = [];
  private priorityInbox: TeamMessage[] = [];
  private notices: string[] = [];
  private processing = false;
  private interruptFlag = false;
  private stopped = false;
  private hourlyCost = 0;
  private hourWindowStart = Date.now();
  private costIdleTimer: ReturnType<typeof setTimeout> | null = null;
  private costIdleUntil: number | null = null;
  private toolExecutor: ToolExecutor | null = null;
  private responseHandler: ResponseHandler | null = null;
  private extraToolsProvider: (() => import('./types.js').AgentToolSet) | null = null;
  private llmSemaphore: Semaphore | null = null;
  private telemetryRecorder: TelemetryRecorder | null = null;

  constructor(config: AgentConfig) {
    this.id = config.id ?? uuidv4();
    this.config = config;
    this._state = AgentState.Idle;
    this.systemPrompt = this.buildSystemPrompt();
  }

  // ── Wiring ──────────────────────────────────────────────────────────────────

  /** Set by orchestrator after construction. */
  setToolExecutor(executor: ToolExecutor): void {
    this.toolExecutor = executor;
  }

  setResponseHandler(handler: ResponseHandler): void {
    this.responseHandler = handler;
  }

  /** Shared semaphore to cap concurrent LLM calls across all agents. */
  setLLMSemaphore(semaphore: Semaphore): void {
    this.llmSemaphore = semaphore;
  }

  setTelemetryRecorder(fn: TelemetryRecorder): void {
    this.telemetryRecorder = fn;
  }

  /** Supplies the agent's MCP tools at call time, split into personal and shared. */
  setExtraToolsProvider(provider: () => import('./types.js').AgentToolSet): void {
    this.extraToolsProvider = provider;
  }

  /** The MCP tools available right now; empty when nothing is wired up. */
  private mcpTools(): import('./types.js').AgentToolSet {
    return this.extraToolsProvider?.() ?? { upfront: [], searchable: [] };
  }

  /** Rename the agent and rebuild their system prompt. */
  rename(newName: string): void {
    this.config.identity.name = newName;
    this.systemPrompt = this.buildSystemPrompt();
  }

  /** Hot-swap the LLM provider and model without restarting the agent. */
  setProvider(provider: AIProvider, model: string): void {
    this.config.provider = provider;
    this.config.model    = model;
  }

  /** Change the agent's thinking hat(s) and rebuild the system prompt. */
  setHat(hatTypes: HatType[]): void {
    this.config.hatType = hatTypes;
    this.systemPrompt = this.buildSystemPrompt();
  }

  /** Called by orchestrator when team roster changes. */
  updateTeamContext(teamContext: string): void {
    this.config.teamContext = teamContext;
    this.systemPrompt = this.buildSystemPrompt();
  }

  /** Called by orchestrator when the active project changes. */
  updateProjectDir(projectDir: string | null): void {
    this.config.projectDir = projectDir ?? undefined;
    this.systemPrompt = this.buildSystemPrompt();
  }

  /** Called by orchestrator when the project goal is set or cleared. */
  updateProjectGoal(goal: string | null): void {
    this.config.projectGoal = goal ?? undefined;
    this.systemPrompt = this.buildSystemPrompt();
  }

  /** Update the agent's specialisation focus and rebuild system prompt. */
  setSpecialisation(specialisation: string | undefined): void {
    this.config.identity.specialisation = specialisation;
    this.systemPrompt = this.buildSystemPrompt();
  }

  /** Update visual description and/or backstory, then rebuild the system prompt. */
  setIdentity(visualDescription: string | undefined, backstory: string | undefined): void {
    if (visualDescription !== undefined) this.config.identity.visualDescription = visualDescription;
    if (backstory !== undefined) this.config.identity.backstory = backstory;
    this.systemPrompt = this.buildSystemPrompt();
  }

  setAvatar(avatar: string | undefined): void {
    this.config.identity.avatar = avatar;
  }

  setBackground(background: string | undefined): void {
    this.config.identity.background = background;
  }

  setVoice(voice: string | undefined, speakerName: string | undefined): void {
    this.config.identity.voice = voice;
    this.config.identity.speakerName = speakerName;
  }

  // ── Inbox ───────────────────────────────────────────────────────────────────

  /** Stop processing permanently — called when the owning project is unloaded. */
  stop(): void {
    this.stopped = true;
    this.interruptFlag = true;
    this.inbox.length = 0;
    this.priorityInbox.length = 0;
    if (this.costIdleTimer) { clearTimeout(this.costIdleTimer); this.costIdleTimer = null; }
    this.costIdleUntil = null;
  }

  /**
   * Team news, read with whatever the agent next works on. It never starts a
   * turn: telling every agent that someone joined would otherwise be a model
   * call per agent for news none of them has to act on. Only the latest are
   * kept, so an agent idle for a long time is not handed a backlog.
   */
  notice(text: string): void {
    this.notices = [...this.notices, text].slice(-MAX_NOTICES);
  }

  /** The held team news as a preface to the next message, emptying it. */
  private takeNotices(): string {
    if (this.notices.length === 0) return '';
    const preface = `Team news since your last turn:\n${this.notices.map((n) => `- ${n}`).join('\n')}\n\n`;
    this.notices = [];
    return preface;
  }

  /** Deliver a message to this agent's inbox and trigger processing. */
  receive(message: TeamMessage): void {
    if (this.stopped) return;
    this.inbox.push(message);
    // Fire-and-forget — errors surface via console
    this.processInbox().catch((err) => {
      log.error(`[${this.name}] inbox processing error:`, err);
    });
  }

  /**
   * Deliver a high-priority message (e.g. human broadcast) that interrupts
   * current work. The agent will finish the current LLM call then process
   * this before resuming any queued regular messages.
   */
  interrupt(message: TeamMessage): void {
    if (this.stopped) return;
    this.priorityInbox.push(message);
    this.interruptFlag = true;
    if (!this.processing) {
      this.processInbox().catch((err) => {
        log.error(`[${this.name}] inbox processing error:`, err);
      });
    }
    // If already processing, the tool loop checks interruptFlag and yields
  }

  private async processInbox(): Promise<void> {
    if (this.processing || this.stopped) return;
    this.processing = true;

    try {
      // Drain priority messages first (e.g. human broadcasts)
      while (this.priorityInbox.length > 0) {
        this.interruptFlag = false;
        const message = this.priorityInbox.shift()!;
        await this.processMessage(message);
      }
      // Then regular inbox
      while (this.inbox.length > 0) {
        if (this._state === AgentState.WaitingForHelp) break; // pause until unblocked
        if (this.interruptFlag) break; // new interrupt arrived — re-enter to handle it
        if (this.isHourlyCostExceeded()) {
          const msLeft = 3_600_000 - (Date.now() - this.hourWindowStart);
          log.warn(`[${this.name}] hourly cost budget exceeded ($${this.hourlyCost.toFixed(4)}) — idling for ${Math.ceil(msLeft / 60000)} min`);
          this.scheduleCostIdleResume(msLeft);
          break;
        }
        const message = this.inbox[0];
        // When waiting for new work, silently drop agent-to-agent chatter
        if (this._state === AgentState.Waiting && message.from !== 'human' && message.type !== 'task') {
          this.inbox.shift();
          continue;
        }
        this.inbox.shift();
        await this.processMessage(message);
      }
    } finally {
      this.processing = false;
      // If a new interrupt arrived while we were in the finally, kick off again
      if (this.priorityInbox.length > 0) {
        this.processInbox().catch((err) => log.error(`[${this.name}] inbox error:`, err));
      }
    }
  }

  // ── Message processing ──────────────────────────────────────────────────────

  private async processMessage(message: TeamMessage): Promise<void> {
    // Update state
    if (message.type === 'task') {
      this.applyEvent('task_assigned');
      const taskId = message.taskId ?? uuidv4();
      if (!this.threads.has(taskId) && message.sourceThreadId) {
        const source = this.threads.get(message.sourceThreadId);
        if (source?.length) {
          const slice = message.sourceThreadLimit ? source.slice(-message.sourceThreadLimit) : source;
          this.threads.set(taskId, [...slice]);
        }
      }
      this.activeTaskId = taskId;
    } else if (message.type === 'meeting_invite' || message.type === 'meeting_turn') {
      if (this._state !== AgentState.InDiscussion) {
        this.applyEvent('discussion_invited');
      }
    }

    // Explicit threadId on the message always wins.
    // Human direct/reply messages default to 'general'; everything else uses the active task thread.
    const historyKey = message.isScheduled ? SCHEDULED_THREAD : message.threadId
      ?? ((message.from === 'human' && (message.type === 'direct' || message.type === 'human_reply'))
        ? 'general'
        : this.activeThreadKey);

    // A scheduled run starts with no history, so news would be read once and
    // lost; it waits for the agent's next ordinary message instead.
    const userContent = (message.isScheduled ? '' : this.takeNotices()) + formatIncomingMessage(message);
    const mcp = this.mcpTools();
    const registry = buildToolRegistry([...getAllToolsForHat(this.config.hatType), ...mcp.upfront, ...mcp.searchable]);
    // Core tools plus whatever the template put in front of the model. The
    // rest is in the registry, reachable through search_tools.
    const tools = [...getToolsForHat(this.config.hatType), ...mcp.upfront];

    // Scheduled tasks start fresh — no history needed for a cron-style trigger
    // working holds the whole conversation; each request sends a window of
    // it. Storage and context used to be the same thing, which is how a cap
    // on what the model sees became a cap on what the agent remembers.
    const history = message.isScheduled ? [] : this.fromStored(this.threads.get(historyKey) ?? []);
    const working: Message[] = [...history, { role: 'user', content: userContent }];
    const turnStart = history.length;
    let withHistory = true;
    const toSend = (): Message[] => withHistory
      ? [...sanitizeHistory(contextWindow(working.slice(0, turnStart),
          this.config.maxContextTokens, MAX_HISTORY_MESSAGES)), ...working.slice(turnStart)]
      : working.slice(turnStart);

    // A scheduled run is sent to the model on its own, but recorded after the
    // earlier runs in its thread rather than replacing them.
    const earlierRuns = message.isScheduled ? this.fromStored(this.threads.get(SCHEDULED_THREAD) ?? []) : [];
    const record = (): void => message.isScheduled
      ? this.persistHistory([...earlierRuns, ...working], historyKey, MAX_SCHEDULED_MESSAGES)
      : this.persistHistory(working, historyKey);

    // Persist user message immediately so it appears in the UI while the agent is thinking.
    // persistHistory is called again after the response to add the agent's reply.
    record();

    // Tool loop — run until text response or max rounds
    const systemPrompt = this.systemPromptFor(message);
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const req: CompletionRequest = {
        systemPrompt,
        messages: toSend(),
        model: this.config.model,
        tools: [...tools], // snapshot so later pushes don't mutate past requests
        agentName: this.name,
      };

      let response;
      try {
        response = await (this.llmSemaphore
          ? this.llmSemaphore.run(() => this.config.provider.complete(req))
          : this.config.provider.complete(req));
      } catch (err) {
        if (err instanceof ProviderError && err.statusCode === 400 && err.message.includes('prompt is too long')) {
          // Send only this turn and retry. This used to empty the thread —
          // the whole conversation deleted to recover from one oversized
          // request. Nothing is deleted now; the model just sees less.
          log.warn(`[${this.name}] context overflow — retrying with this turn only`);
          withHistory = false;
          response = await (this.llmSemaphore
            ? this.llmSemaphore.run(() => this.config.provider.complete({ ...req, messages: toSend() }))
            : this.config.provider.complete({ ...req, messages: toSend() }));
        } else {
          throw err;
        }
      }
      this.recordTelemetry(req, response.inputTokens, response.outputTokens);

      // Human interrupted — stop the tool loop and yield to priority inbox
      if (this.interruptFlag) {
        log.info(`[${this.name}] interrupted by human — pausing current task`);
        break;
      }

      if (response.toolCalls && response.toolCalls.length > 0) {
        // Add assistant message with tool calls to working history
        working.push({
          role: 'assistant',
          content: response.content,
          toolCalls: response.toolCalls,
        });

        // Execute each tool call in sequence
        await this.executeToolCalls(response.toolCalls, registry, tools, working);
        // Continue loop — let LLM respond to tool results
      } else {
        // Final text response
        working.push({ role: 'assistant', content: response.content });
        record();

        // Route the response back via handler (suppress for scheduled tasks — the
        // reply is kept in the scheduled thread, not sent to anyone)
        if (this.responseHandler && response.content.trim() && !message.isScheduled) {
          await this.responseHandler(this.name, message, response.content);
        }
        break;
      }
    }
  }

  // ── Meeting ─────────────────────────────────────────────────────────────────

  /**
   * Produce one meeting turn given the transcript so far.
   * Unlike processMessage, this doesn't route a reply — it just returns the text.
   */
  async meetingTurn(transcript: string, extraMeetingTools: import('../providers/types.js').ToolDefinition[] = []): Promise<string> {
    // Strip meeting-management tools — calling them inside a meeting creates duplicate meetings
    const MEETING_TOOLS = new Set(['request_meeting', 'schedule_meeting']);
    const mcp = this.mcpTools();
    const keep = (t: { name: string }) => !MEETING_TOOLS.has(t.name);
    const upfront = mcp.upfront.filter(keep);
    const allHatTools = getAllToolsForHat(this.config.hatType).filter(keep);
    const meetingRegistry = buildToolRegistry([
      ...allHatTools, ...upfront, ...mcp.searchable.filter(keep), ...extraMeetingTools,
    ]);
    const tools = [
      ...getToolsForHat(this.config.hatType).filter(keep),
      ...upfront,
      ...extraMeetingTools,
    ];
    const earlier = this.fromStored(this.conversationHistory);
    const working: Message[] = [...earlier, { role: 'user', content: transcript }];
    const meetingStart = earlier.length;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const sent = [
        ...sanitizeHistory(contextWindow(working.slice(0, meetingStart),
          this.config.maxContextTokens, MAX_HISTORY_MESSAGES)),
        ...working.slice(meetingStart),
      ];
      const req2 = { systemPrompt: this.systemPrompt, messages: sent, model: this.config.model, tools: [...tools], agentName: this.name };
      const response = await (this.llmSemaphore
        ? this.llmSemaphore.run(() => this.config.provider.complete(req2))
        : this.config.provider.complete(req2));
      this.recordTelemetry(req2, response.inputTokens, response.outputTokens);

      if (response.toolCalls && response.toolCalls.length > 0) {
        working.push({ role: 'assistant', content: response.content, toolCalls: response.toolCalls });
        await this.executeToolCalls(response.toolCalls, meetingRegistry, tools, working);
      } else {
        working.push({ role: 'assistant', content: response.content });
        this.persistHistory(working, this.activeThreadKey);
        return response.content;
      }
    }
    return '(no response)';
  }

  // ── Tool dispatch ───────────────────────────────────────────────────────────

  private async executeToolCalls(
    calls: ToolCall[],
    registry: ToolRegistry,
    tools: import('../providers/types.js').ToolDefinition[],
    working: import('../providers/types.js').Message[],
  ): Promise<void> {
    for (const call of calls) {
      let result: string | ToolOutcome;
      if (call.name === 'search_tools') {
        result = searchTools(call.arguments.query as string, registry);
      } else if (call.name === 'get_tool') {
        const toolName = call.arguments.name as string;
        const found = getTool(toolName, registry);
        result = found.result;
        if (found.found && found.schema && !tools.some(t => t.name === found.schema!.name)) {
          tools.push(found.schema);
        }
      } else {
        result = this.toolExecutor
          ? await this.toolExecutor(this.name, call)
          : `Tool ${call.name} not connected.`;
      }
      const outcome = typeof result === 'string' ? { text: result } : result;
      working.push({
        role: 'tool',
        content: outcome.text,
        toolCallId: call.id,
        toolName: call.name,
        ...(outcome.images?.length ? { images: outcome.images } : {}),
      });
    }
  }

  // ── State ───────────────────────────────────────────────────────────────────

  get state(): AgentState { return this._state; }
  get busy(): boolean { return this.processing; }
  get name(): string { return this.config.identity.name; }
  get hatType(): HatType[] { return this.config.hatType; }

  private applyEvent(event: AgentEvent): void {
    try {
      this._state = transition(this._state, event);
    } catch {
      // Ignore invalid transitions (e.g. invited to discussion while already in one)
    }
  }

  setMaxContextTokens(v: number | undefined): void { this.config.maxContextTokens = v; }
  setUpfrontTools(selectors: string[] | undefined): void { this.config.upfrontTools = selectors; }
  setMaxCostPerHour(v: number | undefined): void {
    this.config.maxCostPerHour = v;
    if (this.costIdleTimer && !this.isHourlyCostExceeded()) this.endCostIdle();
  }

  setPromptSettings(instructions: string | undefined, promptMode: PromptMode | undefined): void {
    this.config.instructions = instructions;
    this.config.promptMode = promptMode;
    this.systemPrompt = this.buildSystemPrompt();
  }
  getHourlyCost(): number { return this.hourlyCost; }
  isCostIdled(): boolean { return this.costIdleTimer !== null; }
  getCostIdleUntil(): number | null { return this.costIdleUntil; }

  markTaskComplete(): void {
    this.applyEvent('task_complete');
    this.activeTaskId = null; // switch back to general thread; task thread is preserved
  }
  clearAllThreads(): void {
    this.threads.clear();
    this.activeTaskId = null;
  }
  getActiveThreadKey(): string { return this.activeThreadKey; }
  markBlocked(): void { this.applyEvent('blocked'); }
  markHelpReceived(): void {
    this.applyEvent('help_received');
    // Resume draining any messages that queued while blocked
    if (this.inbox.length > 0) {
      this.processInbox().catch((err) => log.error(`[${this.name}] inbox resume error:`, err));
    }
  }
  markDiscussionEnded(): void { this.applyEvent('discussion_ended'); }

  // ── Internals ───────────────────────────────────────────────────────────────

  private isHourlyCostExceeded(): boolean {
    if (!this.config.maxCostPerHour) return false;
    if (Date.now() - this.hourWindowStart >= 3_600_000) {
      this.hourlyCost = 0;
      this.hourWindowStart = Date.now();
    }
    return this.hourlyCost >= this.config.maxCostPerHour;
  }

  private scheduleCostIdleResume(msUntilReset: number): void {
    if (this.costIdleTimer) clearTimeout(this.costIdleTimer);
    const wait = Math.max(msUntilReset, 1000);
    this.costIdleUntil = Date.now() + wait;
    this.costIdleTimer = setTimeout(() => {
      this.hourlyCost = 0;
      this.hourWindowStart = Date.now();
      this.endCostIdle();
    }, wait);
  }

  /** Take messages again — the hour is up, or the limit was raised past what was spent. */
  private endCostIdle(): void {
    if (this.costIdleTimer) clearTimeout(this.costIdleTimer);
    this.costIdleTimer = null;
    this.costIdleUntil = null;
    if (this.inbox.length > 0 && !this.stopped) {
      this.processInbox().catch((err) => log.error(`[${this.name}] cost-idle resume error:`, err));
    }
  }

  private recordTelemetry(req: CompletionRequest, inputTokens: number, outputTokens: number): void {
    if (!this.telemetryRecorder) return;
    const promptLength = req.systemPrompt.length +
      req.messages.reduce((n, m) => n + (m.content?.length ?? 0), 0);
    const cost = calcCost(req.model, inputTokens, outputTokens, this.config.provider.name);
    this.hourlyCost += cost;
    this.telemetryRecorder({
      agent:        this.name,
      provider:     this.config.provider.name,
      model:        req.model,
      promptLength,
      inputTokens,
      outputTokens,
      cost,
    });
  }

  /**
   * Whether a board is within reach.
   *
   * The board is built into the runner now, and the orchestrator hands its
   * tools to every agent in a project — whatever the agent's MCP list says.
   * Asking that list for 'kanban' told an agent with, say, only brave-search
   * enabled that it had no board, while the board tools sat in its tool list.
   * Without a project the old rule stands.
   */
  private hasTicketing(): boolean {
    if (this.config.projectDir) return true;
    const allowed = this.config.enabledMcpServers;
    return allowed === undefined || allowed.includes('kanban');
  }

  private buildSystemPrompt(mode = this.config.promptMode): string {
    const prompt = generateSystemPrompt(promptContextFor(this.config, this.hasTicketing()));
    return mode === 'condensed' ? prompt.condensed : prompt.text;
  }

  /** The prompt this message is answered with: its own choice, else the agent's. */
  private systemPromptFor(message: TeamMessage): string {
    const mode = message.promptMode;
    return mode && mode !== (this.config.promptMode ?? 'full') ? this.buildSystemPrompt(mode) : this.systemPrompt;
  }

  /** Both versions of the prompt, with unsaved edits applied — for the editor's preview. */
  previewPrompt(overrides: PromptOverrides = {}): SystemPrompt {
    return generateSystemPrompt(promptContextFor(this.config, this.hasTicketing(), overrides));
  }

  /**
   * Store a thread.
   *
   * Everything, up to MAX_STORED_MESSAGES — not the context window. What the
   * model is shown is decided per request by toSend(); this is what the agent
   * remembers, and it is no longer the same number.
   */
  private persistHistory(working: Message[], historyKey: string, limit = MAX_STORED_MESSAGES): void {
    const now = new Date();
    const kept = sanitizeHistory(working.slice(-limit));
    this.threads.set(historyKey, kept.map((m): AgentMessage => ({
      role: m.role,
      content: m.content,
      timestamp: this.stampOf(m, now),
      toolCalls: m.toolCalls,
      toolCallId: m.toolCallId,
      toolName: m.toolName,
    })));
  }

  /** Stored messages as provider messages, remembering when each was said. */
  private fromStored(stored: AgentMessage[]): Message[] {
    return stored.map((m) => {
      const message = toProviderMessage(m);
      const at = m.timestamp instanceof Date ? m.timestamp : new Date(m.timestamp as unknown as string);
      if (!Number.isNaN(at.getTime())) this.stamps.set(message, at);
      return message;
    });
  }

  /** When a message was first said; now, the first time it is persisted. */
  private stampOf(message: Message, now: Date): Date {
    let at = this.stamps.get(message);
    if (!at) {
      at = now;
      this.stamps.set(message, at);
    }
    return at;
  }

  getHistory(): AgentMessage[] { return [...(this.threads.get('general') ?? [])]; }

  /** Returns all threads as a plain object: { threadKey → messages[] }. */
  getAllThreadHistories(): Record<string, AgentMessage[]> {
    const out: Record<string, AgentMessage[]> = {};
    for (const [key, msgs] of this.threads) {
      if (msgs.length > 0) out[key] = [...msgs];
    }
    return out;
  }

  /** Restore conversation history from a snapshot or live copy.
   *  Accepts the snapshot shape where timestamp is an ISO string
   *  and toolCalls may be untyped JSON. */
  setHistory(history: Array<{
    role: 'user' | 'assistant' | 'tool';
    content: string;
    timestamp: Date | string;
    toolCalls?: ToolCall[] | unknown;
    toolCallId?: string;
    toolName?: string;
  }>): void {
    const restored: AgentMessage[] = history.map((m) => ({
      role:        m.role,
      content:     m.content,
      timestamp:   m.timestamp instanceof Date ? m.timestamp : new Date(m.timestamp as string),
      toolCalls:   m.toolCalls as ToolCall[] | undefined,
      toolCallId:  m.toolCallId,
      toolName:    m.toolName,
    }));
    this.conversationHistory = sanitizeHistory(restored);
  }

  /** Restore all threads from a snapshot { threadKey → messages[] }. */
  setAllThreadHistories(allThreads: Record<string, Array<{
    role: 'user' | 'assistant' | 'tool';
    content: string;
    timestamp: Date | string;
    toolCalls?: ToolCall[] | unknown;
    toolCallId?: string;
    toolName?: string;
  }>>): void {
    this.threads.clear();
    for (const [key, messages] of Object.entries(allThreads)) {
      const restored: AgentMessage[] = messages.map((m) => ({
        role:        m.role,
        content:     m.content,
        timestamp:   m.timestamp instanceof Date ? m.timestamp : new Date(m.timestamp as string),
        toolCalls:   m.toolCalls as ToolCall[] | undefined,
        toolCallId:  m.toolCallId,
        toolName:    m.toolName,
      }));
      this.threads.set(key, sanitizeHistory(restored));
    }
  }

  /** Returns { threadKey -> messageCount } for all non-empty threads. */
  getThreadSummary(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [key, msgs] of this.threads) {
      if (msgs.length > 0) out[key] = msgs.length;
    }
    return out;
  }

  /** Returns messages for a specific thread (default: 'general'). */
  getThreadHistory(key = 'general'): AgentMessage[] {
    return [...(this.threads.get(key) ?? [])];
  }

  toJSON(): object {
    return {
      id: this.id,
      name: this.name,
      hatType: this.config.hatType,
      state: this._state,
      model: this.config.model,
      provider: this.config.provider.name,
      threads: this.getThreadSummary(),
      inboxSize: this.inbox.length,
    };
  }
}

