import { v4 as uuidv4 } from 'uuid';
import { HatType } from '../hats/types.js';
import { getHatDefinition } from '../hats/definitions.js';
import { generateSystemPrompt } from '../prompt/generator.js';
import { AIProvider, CompletionRequest, Message, ToolCall } from '../providers/types.js';
import { getToolsForHat } from '../tools/definitions.js';
import { TeamMessage } from '../orchestrator/types.js';
import { AgentConfig, AgentMessage, AgentState, AgentEvent, ToolExecutor, ResponseHandler } from './types.js';
import { transition } from './state-machine.js';
import { Semaphore } from '../providers/semaphore.js';
import { calcCost } from '../providers/pricing.js';

type TelemetryRecorder = (entry: {
  agent: string; provider: string; model: string;
  promptLength: number; inputTokens: number; outputTokens: number; cost: number;
}) => void;

const MAX_TOOL_ROUNDS    = 10; // prevent infinite tool loops
const MAX_HISTORY_MESSAGES = 20; // cap conversation history to control token usage

export class Agent {
  readonly id: string;
  readonly config: AgentConfig;
  private _state: AgentState;
  private systemPrompt: string;
  private conversationHistory: AgentMessage[];
  private inbox: TeamMessage[] = [];
  private processing = false;
  private toolExecutor: ToolExecutor | null = null;
  private responseHandler: ResponseHandler | null = null;
  private extraToolsProvider: (() => import('../providers/types.js').ToolDefinition[]) | null = null;
  private llmSemaphore: Semaphore | null = null;
  private telemetryRecorder: TelemetryRecorder | null = null;

  constructor(config: AgentConfig) {
    this.id = config.id ?? uuidv4();
    this.config = config;
    this._state = AgentState.Idle;
    this.conversationHistory = [];
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

  /** Change the agent's thinking hat and rebuild the system prompt. */
  setHat(hatType: HatType): void {
    this.config.hatType = hatType;
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

  /** Update the agent's specialisation focus and rebuild system prompt. */
  setSpecialisation(specialisation: string | undefined): void {
    this.config.identity.specialisation = specialisation;
    this.systemPrompt = this.buildSystemPrompt();
  }

  setAvatar(avatar: string | undefined): void {
    this.config.identity.avatar = avatar;
  }

  setVoice(voice: string | undefined, speakerName: string | undefined): void {
    this.config.identity.voice = voice;
    this.config.identity.speakerName = speakerName;
  }

  // ── Inbox ───────────────────────────────────────────────────────────────────

  /** Deliver a message to this agent's inbox and trigger processing. */
  receive(message: TeamMessage): void {
    this.inbox.push(message);
    // Fire-and-forget — errors surface via console
    this.processInbox().catch((err) => {
      console.error(`[${this.name}] inbox processing error:`, err);
    });
  }

  private async processInbox(): Promise<void> {
    if (this.processing) return; // already running
    this.processing = true;

    try {
      while (this.inbox.length > 0) {
        const message = this.inbox.shift()!;
        await this.processMessage(message);
      }
    } finally {
      this.processing = false;
    }
  }

  // ── Message processing ──────────────────────────────────────────────────────

  private async processMessage(message: TeamMessage): Promise<void> {
    // Update state
    if (message.type === 'task') {
      this.applyEvent('task_assigned');
    } else if (message.type === 'meeting_invite' || message.type === 'meeting_turn') {
      if (this._state !== AgentState.InDiscussion) {
        this.applyEvent('discussion_invited');
      }
    }

    const userContent = formatIncomingMessage(message);
    const tools = [
      ...getToolsForHat(this.config.hatType),
      ...(this.extraToolsProvider?.() ?? []),
    ];

    // Build working message history for this turn
    const working: Message[] = [
      ...this.conversationHistory.map(toProviderMessage),
      { role: 'user', content: userContent },
    ];

    // Tool loop — run until text response or max rounds
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const req: CompletionRequest = {
        systemPrompt: this.systemPrompt,
        messages: working,
        model: this.config.model,
        tools,
        agentName: this.name,
      };

      const response = await (this.llmSemaphore
        ? this.llmSemaphore.run(() => this.config.provider.complete(req))
        : this.config.provider.complete(req));
      this.recordTelemetry(req, response.inputTokens, response.outputTokens);

      if (response.toolCalls && response.toolCalls.length > 0) {
        // Add assistant message with tool calls to working history
        working.push({
          role: 'assistant',
          content: response.content,
          toolCalls: response.toolCalls,
        });

        // Execute each tool call in sequence
        for (const call of response.toolCalls) {
          const result = this.toolExecutor
            ? await this.toolExecutor(this.name, call)
            : `Tool ${call.name} not connected.`;

          working.push({
            role: 'tool',
            content: result,
            toolCallId: call.id,
            toolName: call.name,
          });
        }
        // Continue loop — let LLM respond to tool results
      } else {
        // Final text response
        working.push({ role: 'assistant', content: response.content });
        this.persistHistory(working, userContent);

        // Route the response back via handler
        if (this.responseHandler && response.content.trim()) {
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
  async meetingTurn(transcript: string): Promise<string> {
    // Strip meeting-management tools — calling them inside a meeting creates duplicate meetings
    const MEETING_TOOLS = new Set(['request_meeting', 'schedule_meeting']);
    const tools = [
      ...getToolsForHat(this.config.hatType).filter(t => !MEETING_TOOLS.has(t.name)),
      ...(this.extraToolsProvider?.() ?? []).filter(t => !MEETING_TOOLS.has(t.name)),
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
        for (const call of response.toolCalls) {
          // In a meeting, most tools route back to orchestrator via executor
          const result = this.toolExecutor
            ? await this.toolExecutor(this.name, call)
            : `Tool ${call.name} not connected.`;
          working.push({ role: 'tool', content: result, toolCallId: call.id, toolName: call.name });
        }
      } else {
        working.push({ role: 'assistant', content: response.content });
        this.persistHistory(working, transcript);
        return response.content;
      }
    }
    return '(no response)';
  }

  // ── State ───────────────────────────────────────────────────────────────────

  get state(): AgentState { return this._state; }
  get name(): string { return this.config.identity.name; }
  get hatType(): HatType { return this.config.hatType; }

  private applyEvent(event: AgentEvent): void {
    try {
      this._state = transition(this._state, event);
    } catch {
      // Ignore invalid transitions (e.g. invited to discussion while already in one)
    }
  }

  markTaskComplete(): void { this.applyEvent('task_complete'); }
  markBlocked(): void { this.applyEvent('blocked'); }
  markHelpReceived(): void { this.applyEvent('help_received'); }
  markDiscussionEnded(): void { this.applyEvent('discussion_ended'); }

  // ── Internals ───────────────────────────────────────────────────────────────

  private recordTelemetry(req: CompletionRequest, inputTokens: number, outputTokens: number): void {
    if (!this.telemetryRecorder) return;
    const promptLength = req.systemPrompt.length +
      req.messages.reduce((n, m) => n + (m.content?.length ?? 0), 0);
    this.telemetryRecorder({
      agent:        this.name,
      provider:     this.config.provider.name,
      model:        req.model,
      promptLength,
      inputTokens,
      outputTokens,
      cost: calcCost(req.model, inputTokens, outputTokens, this.config.provider.name),
    });
  }

  private buildSystemPrompt(): string {
    const hat = getHatDefinition(this.config.hatType);
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
      specialisation: this.config.identity.specialisation,
    }).text;
  }

  private persistHistory(working: Message[], userContent: string): void {
    void userContent;
    const sliced = working.slice(-MAX_HISTORY_MESSAGES);
    this.conversationHistory = sanitizeHistory(sliced).map((m): AgentMessage => ({
      role: m.role,
      content: m.content,
      timestamp: new Date(),
      toolCalls: m.toolCalls,
      toolCallId: m.toolCallId,
      toolName: m.toolName,
    }));
  }

  getHistory(): AgentMessage[] { return [...this.conversationHistory]; }

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

  toJSON(): object {
    return {
      id: this.id,
      name: this.name,
      hatType: this.config.hatType,
      state: this._state,
      model: this.config.model,
      provider: this.config.provider.name,
      historyLength: this.conversationHistory.length,
      inboxSize: this.inbox.length,
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Remove any messages that would cause an Anthropic API error:
 *
 * 1. Leading non-user messages (first message must be a plain user message)
 * 2. Assistant tool-call groups where not ALL tool_use IDs have a matching
 *    tool_result in the immediately following tool messages — the entire group
 *    (assistant + partial results) is dropped
 * 3. Orphaned tool-result messages that appear outside of a valid group
 *
 * Processes messages as groups so partial sequences are always removed together.
 */
function sanitizeHistory<T extends { role: string; toolCalls?: ToolCall[]; toolCallId?: string }>(
  messages: T[],
): T[] {
  if (messages.length === 0) return messages;

  // 1. Drop everything before the first plain user message
  const firstUser = messages.findIndex((m) => m.role === 'user' && !m.toolCallId);
  const msgs = firstUser > 0 ? messages.slice(firstUser) : [...messages];

  const out: T[] = [];
  let i = 0;

  while (i < msgs.length) {
    const m = msgs[i]!;

    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      // Collect ALL immediately following tool-result messages
      const results: T[] = [];
      let j = i + 1;
      while (j < msgs.length && msgs[j]!.role === 'tool') {
        results.push(msgs[j]!);
        j++;
      }

      // Valid only if every tool_call ID has a matching tool_result
      const expectedIds = new Set(m.toolCalls.map((tc) => tc.id));
      const coveredIds  = new Set(results.map((r) => r.toolCallId));
      const complete    = expectedIds.size > 0 &&
        [...expectedIds].every((id) => coveredIds.has(id));

      if (complete) {
        out.push(m);
        for (const r of results) out.push(r);
      }
      // else: drop the whole group (assistant + partial results)
      i = j; // advance past results regardless

    } else if (m.role === 'tool') {
      // Orphaned tool result outside a valid group — drop it
      i++;
    } else {
      out.push(m);
      i++;
    }
  }

  return out;
}

function toProviderMessage(m: AgentMessage): Message {
  return {
    role: m.role,
    content: m.content,
    toolCalls: m.toolCalls,
    toolCallId: m.toolCallId,
    toolName: m.toolName,
  };
}

function formatIncomingMessage(msg: TeamMessage): string {
  switch (msg.type) {
    case 'task':
      return `[TASK from ${msg.from}] ${msg.content}`;
    case 'direct':
      return `[MESSAGE from ${msg.from}] ${msg.content}`;
    case 'meeting_invite':
      return `[MEETING INVITE from ${msg.from}] ${msg.content}`;
    case 'escalation':
      return `[ESCALATION from ${msg.from}] ${msg.content}`;
    case 'human_reply':
      return `[HUMAN REPLY] ${msg.content}`;
    case 'task_complete':
      return `[TASK COMPLETE from ${msg.from}] ${msg.content}`;
    default:
      return msg.content;
  }
}
