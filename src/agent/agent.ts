import { v4 as uuidv4 } from 'uuid';
import { log } from '../util/logger.js';
import { HatType } from '../hats/types.js';
import { mergeHatDefinitions } from '../hats/definitions.js';
import { generateSystemPrompt } from '../prompt/generator.js';
import { AIProvider, CompletionRequest, Message, ProviderError, ToolCall } from '../providers/types.js';
import { getToolsForHat, getAllToolsForHat } from '../tools/definitions.js';
import { buildToolRegistry, searchTools, getTool, ToolRegistry } from '../tools/tool-search.js';
import { TeamMessage } from '../orchestrator/types.js';
import { AgentConfig, AgentMessage, AgentState, AgentEvent, ToolExecutor, ResponseHandler } from './types.js';
import { transition } from './state-machine.js';
import { Semaphore } from '../providers/semaphore.js';
import { calcCost } from '../providers/pricing.js';
import { sanitizeHistory, toProviderMessage, formatIncomingMessage } from './agent-utils.js';

type TelemetryRecorder = (entry: {
  agent: string; provider: string; model: string;
  promptLength: number; inputTokens: number; outputTokens: number; cost: number;
}) => void;

const MAX_TOOL_ROUNDS      = 10; // prevent infinite tool loops
const MAX_HISTORY_MESSAGES = 20; // fallback cap when no maxContextTokens is set

export class Agent {
  readonly id: string;
  readonly config: AgentConfig;
  private _state: AgentState;
  private systemPrompt: string;
  private threads = new Map<string, AgentMessage[]>();
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
  private processing = false;
  private interruptFlag = false;
  private stopped = false;
  private hourlyCost = 0;
  private hourWindowStart = Date.now();
  private costIdleTimer: ReturnType<typeof setTimeout> | null = null;
  private toolExecutor: ToolExecutor | null = null;
  private responseHandler: ResponseHandler | null = null;
  private extraToolsProvider: (() => import('../providers/types.js').ToolDefinition[]) | null = null;
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

  /** Provider function that returns extra tools (e.g. MCP) to merge at call time. */
  setExtraToolsProvider(provider: () => import('../providers/types.js').ToolDefinition[]): void {
    this.extraToolsProvider = provider;
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
        if (source?.length) this.threads.set(taskId, [...source]);
      }
      this.activeTaskId = taskId;
    } else if (message.type === 'meeting_invite' || message.type === 'meeting_turn') {
      if (this._state !== AgentState.InDiscussion) {
        this.applyEvent('discussion_invited');
      }
    }

    // Explicit threadId on the message always wins.
    // Human direct/reply messages default to 'general'; everything else uses the active task thread.
    const historyKey = message.threadId
      ?? ((message.from === 'human' && (message.type === 'direct' || message.type === 'human_reply'))
        ? 'general'
        : this.activeThreadKey);

    const userContent = formatIncomingMessage(message);
    const mcpTools = this.extraToolsProvider?.() ?? [];
    const registry = buildToolRegistry([...getAllToolsForHat(this.config.hatType), ...mcpTools]);
    let tools = [...getToolsForHat(this.config.hatType)]; // core only; on-demand tools injected via get_tool

    // Scheduled tasks start fresh — no history needed for a cron-style trigger
    const history = message.isScheduled ? [] : (this.threads.get(historyKey) ?? []).map(toProviderMessage);
    const working: Message[] = [...history, { role: 'user', content: userContent }];

    // Persist user message immediately so it appears in the UI while the agent is thinking.
    // persistHistory is called again after the response to add the agent's reply.
    if (!message.isScheduled) this.persistHistory(working, historyKey);

    // Tool loop — run until text response or max rounds
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const req: CompletionRequest = {
        systemPrompt: this.systemPrompt,
        messages: working,
        model: this.config.model,
        tools,
        agentName: this.name,
      };

      let response;
      try {
        response = await (this.llmSemaphore
          ? this.llmSemaphore.run(() => this.config.provider.complete(req))
          : this.config.provider.complete(req));
      } catch (err) {
        if (err instanceof ProviderError && err.statusCode === 400 && err.message.includes('prompt is too long')) {
          log.warn(`[${this.name}] context overflow — clearing history and retrying`);
          this.threads.set(historyKey, []);
          // Rebuild with only the triggering user message — safe regardless of where in the tool loop we are
          working.splice(0);
          working.push({ role: 'user', content: userContent });
          response = await (this.llmSemaphore
            ? this.llmSemaphore.run(() => this.config.provider.complete({ ...req, messages: working }))
            : this.config.provider.complete({ ...req, messages: working }));
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
        // Scheduled messages are fire-and-forget — don't overwrite the active thread
        if (!message.isScheduled) {
          this.persistHistory(working, historyKey);
        }

        // Route the response back via handler (suppress for scheduled tasks)
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
    const mcpMeetingTools = (this.extraToolsProvider?.() ?? []).filter(t => !MEETING_TOOLS.has(t.name));
    const allHatTools = getAllToolsForHat(this.config.hatType).filter(t => !MEETING_TOOLS.has(t.name));
    const meetingRegistry = buildToolRegistry([...allHatTools, ...mcpMeetingTools, ...extraMeetingTools]);
    let tools = [
      ...getToolsForHat(this.config.hatType).filter(t => !MEETING_TOOLS.has(t.name)),
      ...extraMeetingTools,
    ];
    const working: Message[] = [
      ...this.conversationHistory.map(toProviderMessage),
      { role: 'user', content: transcript },
    ];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const req2 = { systemPrompt: this.systemPrompt, messages: working, model: this.config.model, tools, agentName: this.name };
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
      let result: string;
      if (call.name === 'search_tools') {
        result = searchTools(call.arguments.query as string, registry);
      } else if (call.name === 'get_tool') {
        const toolName = call.arguments.name as string;
        const found = getTool(toolName, registry);
        result = found.result;
        if (found.found && found.schema && !tools.some(t => t.name === toolName)) {
          tools.push(found.schema);
        }
      } else {
        result = this.toolExecutor
          ? await this.toolExecutor(this.name, call)
          : `Tool ${call.name} not connected.`;
      }
      working.push({ role: 'tool', content: result, toolCallId: call.id, toolName: call.name });
    }
  }

  // ── State ───────────────────────────────────────────────────────────────────

  get state(): AgentState { return this._state; }
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
  setMaxCostPerHour(v: number | undefined): void { this.config.maxCostPerHour = v; }
  getHourlyCost(): number { return this.hourlyCost; }
  isCostIdled(): boolean { return this.costIdleTimer !== null; }

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
    this.costIdleTimer = setTimeout(() => {
      this.costIdleTimer = null;
      this.hourlyCost = 0;
      this.hourWindowStart = Date.now();
      if (this.inbox.length > 0 && !this.stopped) {
        this.processInbox().catch((err) => log.error(`[${this.name}] cost-idle resume error:`, err));
      }
    }, Math.max(msUntilReset, 1000));
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

  private buildSystemPrompt(): string {
    const hat = mergeHatDefinitions(this.config.hatType);
    return generateSystemPrompt({
      name: this.config.identity.name,
      visualDescription: this.config.identity.visualDescription,
      backstory: this.config.identity.backstory,
      hatLabel: hat.label,
      thinkingStyle: hat.thinkingStyle,
      communicationTone: hat.communicationTone,
      directives: hat.directives,
      avoidances: hat.avoidances,
      teamRole: hat.teamRole,
      teamContext: this.config.teamContext,
      projectDir: this.config.projectDir,
      projectGoal: this.config.projectGoal,
      specialisation: this.config.identity.specialisation,
      email: this.config.identity.email,
    }).text;
  }

  private persistHistory(working: Message[], historyKey: string): void {
    let sliced = working;
    if (this.config.maxContextTokens) {
      const maxChars = this.config.maxContextTokens * 4; // ~4 chars per token
      while (sliced.length > 2) {
        const totalChars = sliced.reduce((n, m) => n + (m.content?.length ?? 0), 0);
        if (totalChars <= maxChars) break;
        sliced = sliced.slice(1);
      }
    } else {
      sliced = sliced.slice(-MAX_HISTORY_MESSAGES);
    }
    this.threads.set(historyKey, sanitizeHistory(sliced).map((m): AgentMessage => ({
      role: m.role,
      content: m.content,
      timestamp: new Date(),
      toolCalls: m.toolCalls,
      toolCallId: m.toolCallId,
      toolName: m.toolName,
    })));
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

