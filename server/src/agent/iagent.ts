import { HatType } from '../../../packages/core/src/hats/types.js';
import type { PromptMode, SystemPrompt } from '../../../packages/core/src/prompt/types.js';
import type { PromptOverrides } from './prompt-context.js';
import { AIProvider, ToolDefinition } from '../providers/types.js';
import { TeamMessage } from '../orchestrator/types.js';
import { Semaphore } from '../providers/semaphore.js';
import { AgentConfig, AgentMessage, AgentState, AgentToolSet, ToolExecutor, ResponseHandler } from './types.js';

type TelemetryEntry = {
  agent: string; provider: string; model: string;
  promptLength: number; inputTokens: number; outputTokens: number; cost: number;
};

type HistoryEntryLike = {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: Date | string;
  toolCalls?: unknown;
  toolCallId?: string;
  toolName?: string;
};

/**
 * Common interface implemented by both local Agent and ExternalAgent.
 * The orchestrator and all infrastructure code targets this interface.
 */
export interface IAgent {
  readonly id: string;
  readonly name: string;
  readonly hatType: HatType[];
  readonly state: AgentState;
  /** Handling a message right now — a model call, its tools, the reply. */
  readonly busy: boolean;
  readonly config: AgentConfig;

  // ── Inbox ───────────────────────────────────────────────────────────────────
  receive(message: TeamMessage): void;
  interrupt(message: TeamMessage): void;
  /** Team news, such as a member joining. Held until the agent's next turn: it never wakes the agent. */
  notice(text: string): void;
  markHelpReceived(): void;
  markBlocked(): void;
  markTaskComplete(): void;
  markDiscussionEnded(): void;
  stop(): void;

  toJSON(): object;

  // ── Wiring (may be no-ops for non-LLM agents) ────────────────────────────
  setToolExecutor(executor: ToolExecutor): void;
  setResponseHandler(handler: ResponseHandler): void;
  setExtraToolsProvider(fn: () => AgentToolSet): void;
  setLLMSemaphore(semaphore: Semaphore): void;
  setTelemetryRecorder(fn: (entry: TelemetryEntry) => void): void;

  // ── Config mutations ─────────────────────────────────────────────────────
  rename(newName: string): void;
  setProvider(provider: AIProvider, model: string): void;
  setHat(hatTypes: HatType[]): void;
  updateTeamContext(teamContext: string): void;
  updateProjectDir(projectDir: string | null): void;
  updateProjectGoal(goal: string | null): void;
  setSpecialisation(specialisation: string | undefined): void;
  setIdentity(visualDescription: string | undefined, backstory: string | undefined): void;
  setAvatar(avatar: string | undefined): void;
  setBackground(background: string | undefined): void;
  setVoice(voice: string | undefined, speakerName: string | undefined): void;
  setMaxContextTokens(v: number | undefined): void;
  setMaxCostPerHour(v: number | undefined): void;
  /** Which MCP tools go in every call; undefined for the default. */
  setUpfrontTools(selectors: string[] | undefined): void;
  /** Change the free-text instructions and which prompt (full or condensed) the agent is given. */
  setPromptSettings(instructions: string | undefined, promptMode: PromptMode | undefined): void;
  /** Both versions of the system prompt, with unsaved edits applied. Absent when the agent has no prompt of its own. */
  previewPrompt?(overrides?: PromptOverrides): SystemPrompt;

  // ── History ──────────────────────────────────────────────────────────────
  getHistory(): AgentMessage[];
  getAllThreadHistories(): Record<string, AgentMessage[]>;
  getThreadSummary(): Record<string, number>;
  getThreadHistory(thread: string): AgentMessage[];
  getActiveThreadKey(): string;
  getHourlyCost(): number;
  isCostIdled(): boolean;
  /** When a budget pause ends (ms since epoch), or null when not paused. */
  getCostIdleUntil(): number | null;
  clearAllThreads(): void;
  setHistory(history: HistoryEntryLike[]): void;
  setAllThreadHistories(allThreads: Record<string, HistoryEntryLike[]>): void;

  // ── Meeting (direct LLM turn — returns response text) ───────────────────
  meetingTurn(transcript: string, extraTools?: ToolDefinition[]): Promise<string>;

  // ── External callback — only implemented by ExternalAgent ───────────────
  handleExternalCallback?(messageId: string, response: string): Promise<void>;
}
