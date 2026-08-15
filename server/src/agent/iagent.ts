import { HatType } from '../hats/types.js';
import { AIProvider, ToolDefinition } from '../providers/types.js';
import { TeamMessage } from '../orchestrator/types.js';
import { Semaphore } from '../providers/semaphore.js';
import { AgentConfig, AgentMessage, AgentState, ToolExecutor, ResponseHandler } from './types.js';

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
  readonly config: AgentConfig;

  // ── Inbox ───────────────────────────────────────────────────────────────────
  receive(message: TeamMessage): void;
  interrupt(message: TeamMessage): void;
  markHelpReceived(): void;
  markBlocked(): void;
  markTaskComplete(): void;
  markDiscussionEnded(): void;
  stop(): void;

  toJSON(): object;

  // ── Wiring (may be no-ops for non-LLM agents) ────────────────────────────
  setToolExecutor(executor: ToolExecutor): void;
  setResponseHandler(handler: ResponseHandler): void;
  setExtraToolsProvider(fn: () => ToolDefinition[]): void;
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

  // ── History ──────────────────────────────────────────────────────────────
  getHistory(): AgentMessage[];
  getAllThreadHistories(): Record<string, AgentMessage[]>;
  getThreadSummary(): Record<string, number>;
  getThreadHistory(thread: string): AgentMessage[];
  getActiveThreadKey(): string;
  getHourlyCost(): number;
  isCostIdled(): boolean;
  clearAllThreads(): void;
  setHistory(history: HistoryEntryLike[]): void;
  setAllThreadHistories(allThreads: Record<string, HistoryEntryLike[]>): void;

  // ── Meeting (direct LLM turn — returns response text) ───────────────────
  meetingTurn(transcript: string, extraTools?: ToolDefinition[]): Promise<string>;

  // ── External callback — only implemented by ExternalAgent ───────────────
  handleExternalCallback?(messageId: string, response: string): Promise<void>;
}
