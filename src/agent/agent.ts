import { v4 as uuidv4 } from 'uuid';
import { HatType } from '../hats/types.js';
import { getHatDefinition } from '../hats/definitions.js';
import { generateSystemPrompt } from '../prompt/generator.js';
import { CompletionRequest, Message } from '../providers/types.js';
import { getToolsForHat } from '../tools/definitions.js';
import { TeamMessage } from '../orchestrator/types.js';
import { AgentConfig, AgentMessage, AgentState, AgentEvent, ToolExecutor, ResponseHandler } from './types.js';
import { transition } from './state-machine.js';
import { Semaphore } from '../providers/semaphore.js';

const MAX_TOOL_ROUNDS = 10; // prevent infinite tool loops

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

  constructor(config: AgentConfig) {
    this.id = uuidv4();
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

  /** Provider function that returns extra tools (e.g. MCP) to merge at call time. */
  setExtraToolsProvider(provider: () => import('../providers/types.js').ToolDefinition[]): void {
    this.extraToolsProvider = provider;
  }

  /** Called by orchestrator when team roster changes. */
  updateTeamContext(teamContext: string): void {
    this.config.teamContext = teamContext;
    this.systemPrompt = this.buildSystemPrompt();
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
      };

      const response = await (this.llmSemaphore
        ? this.llmSemaphore.run(() => this.config.provider.complete(req))
        : this.config.provider.complete(req));

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
    const tools = [
      ...getToolsForHat(this.config.hatType),
      ...(this.extraToolsProvider?.() ?? []),
    ];
    const working: Message[] = [
      ...this.conversationHistory.map(toProviderMessage),
      { role: 'user', content: transcript },
    ];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const req2 = { systemPrompt: this.systemPrompt, messages: working, model: this.config.model, tools };
      const response = await (this.llmSemaphore
        ? this.llmSemaphore.run(() => this.config.provider.complete(req2))
        : this.config.provider.complete(req2));

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
    }).text;
  }

  private persistHistory(working: Message[], userContent: string): void {
    void userContent;
    let sliced = working.slice(-40);

    // Never start with a tool-result or assistant message — Anthropic requires
    // the first message to be a regular user message (no toolCallId).
    const firstUserIdx = sliced.findIndex((m) => m.role === 'user' && !m.toolCallId);
    if (firstUserIdx > 0) sliced = sliced.slice(firstUserIdx);

    this.conversationHistory = sliced.map((m): AgentMessage => ({
      role: m.role,
      content: m.content,
      timestamp: new Date(),
      toolCalls: m.toolCalls,
      toolCallId: m.toolCallId,
      toolName: m.toolName,
    }));
  }

  getHistory(): AgentMessage[] { return [...this.conversationHistory]; }

  /** Restore conversation history (e.g. from a saved snapshot). */
  setHistory(history: AgentMessage[]): void {
    this.conversationHistory = history.map((m) => ({
      ...m,
      timestamp: m.timestamp instanceof Date ? m.timestamp : new Date(m.timestamp),
    }));
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
