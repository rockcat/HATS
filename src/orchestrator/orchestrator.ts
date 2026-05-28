import * as nodePath from 'path';
import { readFile, writeFile, rename, mkdir } from 'fs/promises';
import { log } from '../util/logger.js';
import { Agent } from '../agent/agent.js';
import { AgentConfig } from '../agent/types.js';
import { HatType } from '../hats/types.js';
import { getToolsForHat } from '../tools/definitions.js';
import { AIProvider } from '../providers/types.js';
import { EventStore } from '../store/event-store.js';
import { MCPRegistry } from '../mcp/mcp-registry.js';
import { MCPServerDef } from '../mcp/mcp-client.js';
import { Semaphore } from '../providers/semaphore.js';
import { TeamSnapshot, TeamSnapshotV1, TeamSnapshotV2, AgentSnapshot, AgentDefinition, HistoryEntry } from '../store/team-snapshot.js';
import { AgentStore } from '../api/agent-store.js';
import { MeetingRoom } from './meeting-room.js';
import { TeamMessage, Task, Meeting, MeetingTurn, ScheduledMeeting, MeetingType } from './types.js';
import { MeetingStore } from './meeting-store.js';
import { buildMessage } from './orchestrator-utils.js';
import {
  deliverToAgent as deliverToAgentFn,
  findBlueHat as findBlueHatFn,
  createTask as createTaskFn,
  resolveAgentPath as resolveAgentPathFn,
} from './orchestrator-helpers.js';
import { buildToolExecutor, ToolCallContext } from './tool-executor.js';
import { EmailAllowlistStore } from '../api/email-allowlist-store.js';
import { AgendaStore } from '../api/agenda-store.js';
import { AgendaRunner } from './agenda-runner.js';
import { resolvePersonalConfig } from '../mcp/mcp-catalogue.js';
import { getCatalogue } from '../mcp/catalogue-store.js';
import {
  startMeeting as startMeetingFn,
  makeResponseHandler as makeResponseHandlerFn,
} from './meeting-runner.js';
import * as sm from './scheduled-meetings.js';

export type ProviderFactory = (providerName: string) => AIProvider;

export interface OrchestratorConfig {
  storePath?: string;
  humanName?: string;
  maxTasksPerAgent?: number;
  projectsRoot?: string;
  llmConcurrency?: number;
  llmCallIntervalMs?: number;
}

export class TeamOrchestrator {
  private agents: Map<string, Agent> = new Map();
  private tasks: Map<string, Task> = new Map();
  private meetings: Map<string, Meeting> = new Map();
  private activeMeetingRooms: Map<string, MeetingRoom> = new Map();
  private scheduledMeetingStore: MeetingStore | null = null;
  private store: EventStore;
  private humanName: string;
  private projectsRoot: string;
  private projectDir: string | null = null;
  private projectGoal: string | null = null;
  private onHumanEscalation: ((from: string, message: string, urgency: string) => void) | null = null;
  private onHumanMeetingTurn: ((meetingId: string, turns: MeetingTurn[], topic: string) => Promise<string | null>) | null = null;
  private onMeetingTurnPaced: ((meetingId: string, participant: string) => Promise<void>) | null = null;
  /** Mutable ref so the store can be set/replaced after agents are registered. */
  private emailAllowlistRef: { store: EmailAllowlistStore | null } = { store: null };
  /** Per-agent personal MCP registries, keyed by lowercase agent name. */
  private personalMcpByAgent = new Map<string, MCPRegistry>();
  private agendaStoreRef: { store: AgendaStore | null } = { store: null };
  private agendaRunner: AgendaRunner | null = null;
  private agendaDefaultsSeeded = new Set<string>();
  private agentStore: AgentStore | null = null;
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private mcp = new MCPRegistry();
  private llmSemaphore: Semaphore;
  private lastSenderByAgent = new Map<string, string>();
  private telemetryRecorder: ((entry: { agent: string; provider: string; model: string; promptLength: number; inputTokens: number; outputTokens: number; cost: number }) => void) | null = null;

  constructor(config: OrchestratorConfig = {}) {
    this.store = new EventStore(config.storePath ?? './team-events.jsonl');
    this.humanName = config.humanName ?? 'Human';
    this.projectsRoot = nodePath.resolve(config.projectsRoot ?? './projects');
    this.llmSemaphore = new Semaphore(
      config.llmConcurrency    ?? 2,
      config.llmCallIntervalMs ?? 3000,
    );
  }

  async init(): Promise<void> {
    await this.store.init();
    await mkdir(this.projectsRoot, { recursive: true });
    await this.store.append('session_start', { humanName: this.humanName });
  }

  async initMeetingStore(filePath: string): Promise<void> {
    this.scheduledMeetingStore = new MeetingStore(filePath);
    await this.scheduledMeetingStore.load();
  }

  async initAgendaStore(filePath: string): Promise<void> {
    const store = new AgendaStore(filePath);
    await store.load();
    this.agendaStoreRef.store = store;
    this.agendaRunner?.stop();
    this.agendaRunner = new AgendaRunner(store, (name, content) => this.humanMessage(name, content));
    this.agendaRunner.start();
  }

  getAgendaStore(): AgendaStore | null { return this.agendaStoreRef.store; }

  stopAgendaRunner(): void { this.agendaRunner?.stop(); }

  setAgentStore(store: AgentStore): void { this.agentStore = store; }
  getAgentStore(): AgentStore | null { return this.agentStore; }

  async addMCPServer(def: MCPServerDef): Promise<void> {
    await this.mcp.add(def);
    await this.store.append('mcp_server_added', { name: def.name });
    this.rebuildTeamContext();
  }

  async removeMCPServer(name: string): Promise<void> {
    await this.mcp.disconnect(name);
    await this.store.append('mcp_server_removed', { name });
  }

  hasMCPServer(name: string): boolean {
    return this.mcp.has(name);
  }

  clearTeam(): void {
    this.agents.clear();
    this.tasks.clear();
    this.meetings.clear();
  }

  async shutdown(snapshotPath?: string): Promise<void> {
    if (snapshotPath) await this.saveState(snapshotPath);
    for (const agent of this.agents.values()) agent.stop();
    this.agendaRunner?.stop();
    await this.mcp.disconnectAll();
    await Promise.all(Array.from(this.personalMcpByAgent.values()).map(r => r.disconnectAll()));
    this.personalMcpByAgent.clear();
    await this.store.append('session_end', {});
  }

  // ── State persistence ──────────────────────────────────────────────────────

  async saveState(filePath: string): Promise<void> {
    const history = (agent: Agent): HistoryEntry[] =>
      agent.getHistory().map((m) => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : String(m.timestamp),
        toolCalls: m.toolCalls,
        toolCallId: m.toolCallId,
        toolName: m.toolName,
      }));

    if (this.agentStore) {
      // V2: persist agent configs to global store; only histories go in the project file
      const agentIds: string[]                      = [];
      const agentHistories: Record<string, HistoryEntry[]> = {};
      for (const agent of this.agents.values()) {
        agentIds.push(agent.id);
        agentHistories[agent.id] = history(agent);
        const existingDef = this.agentStore.get(agent.id);
        const def: AgentDefinition = {
          id:                    agent.id,
          identity:              agent.config.identity,
          hatType:               agent.config.hatType,
          model:                 agent.config.model,
          providerName:          agent.config.provider.name,
          teamContext:           agent.config.teamContext,
          enabledMcpServers:     agent.config.enabledMcpServers,
          personalMcpCredentials: agent.config.personalMcpCredentials,
          scheduledActionIds:    existingDef?.scheduledActionIds ?? [],
        };
        await this.agentStore.addOrUpdate(def);
      }
      const snapshot: TeamSnapshotV2 = {
        version: 2,
        savedAt: new Date().toISOString(),
        humanName: this.humanName,
        agentIds,
        agentHistories,
        tasks: Array.from(this.tasks.values()),
        meetings: Array.from(this.meetings.values()),
        mcpServers: this.mcp.getServerDefs(),
      };
      const tmp = filePath + '.tmp';
      await writeFile(tmp, JSON.stringify(snapshot, null, 2), 'utf-8');
      await rename(tmp, filePath);
      await this.store.append('state_saved', { path: filePath, agentCount: agentIds.length });
    } else {
      // V1: all data in one file (legacy / no global store wired)
      const agentSnapshots: AgentSnapshot[] = Array.from(this.agents.values()).map((agent) => ({
        id: agent.id,
        identity: agent.config.identity,
        hatType: agent.config.hatType,
        model: agent.config.model,
        providerName: agent.config.provider.name,
        teamContext: agent.config.teamContext,
        enabledMcpServers: agent.config.enabledMcpServers,
        personalMcpCredentials: agent.config.personalMcpCredentials,
        history: history(agent),
      }));
      const snapshot: TeamSnapshotV1 = {
        version: 1,
        savedAt: new Date().toISOString(),
        humanName: this.humanName,
        agents: agentSnapshots,
        tasks: Array.from(this.tasks.values()),
        meetings: Array.from(this.meetings.values()),
        mcpServers: this.mcp.getServerDefs(),
      };
      const tmp = filePath + '.tmp';
      await writeFile(tmp, JSON.stringify(snapshot, null, 2), 'utf-8');
      await rename(tmp, filePath);
      await this.store.append('state_saved', { path: filePath, agentCount: agentSnapshots.length });
    }
    log.info(`\n[Team] State saved to ${filePath}`);
  }

  async loadState(filePath: string, providerFactory: ProviderFactory): Promise<MCPServerDef[]> {
    const raw = await readFile(filePath, 'utf-8');
    let snapshot: TeamSnapshot;
    try {
      snapshot = JSON.parse(raw) as TeamSnapshot;
    } catch (err) {
      throw new Error(`State file "${filePath}" is corrupt (${(err as Error).message}). Delete it to start fresh.`);
    }

    if (snapshot.version !== 1 && snapshot.version !== 2) {
      throw new Error(`Unsupported snapshot version: ${(snapshot as TeamSnapshot).version}`);
    }

    if (snapshot.version === 1) {
      // V1: load embedded agent configs + histories
      for (const snap of (snapshot as TeamSnapshotV1).agents) {
        const provider = providerFactory(snap.providerName);
        const config: AgentConfig = {
          id: snap.id,
          identity: snap.identity,
          hatType: Array.isArray(snap.hatType) ? snap.hatType : [snap.hatType as HatType],
          provider,
          model: snap.model,
          teamContext: snap.teamContext,
          enabledMcpServers: snap.enabledMcpServers,
          personalMcpCredentials: snap.personalMcpCredentials,
        };
        const agent = this.registerAgent(config);
        agent.setHistory(snap.history);
      }
      // Migrate to global store if available — save defs without history
      if (this.agentStore) {
        for (const snap of (snapshot as TeamSnapshotV1).agents) {
          if (!this.agentStore.has(snap.id)) {
            await this.agentStore.addOrUpdate({
              id:                    snap.id,
              identity:              snap.identity,
              hatType:               Array.isArray(snap.hatType) ? snap.hatType : [snap.hatType as HatType],
              model:                 snap.model,
              providerName:          snap.providerName,
              teamContext:           snap.teamContext,
              enabledMcpServers:     snap.enabledMcpServers,
              personalMcpCredentials: snap.personalMcpCredentials,
              scheduledActionIds:    [],
            });
          }
        }
      }
      const s = snapshot as TeamSnapshotV1;
      for (const task of s.tasks) this.tasks.set(task.id, task);
      for (const meeting of s.meetings) this.meetings.set(meeting.id, meeting);
      if (s.humanName) this.humanName = s.humanName;
      await this.store.append('state_loaded', { path: filePath, agentCount: s.agents.length });
      log.info(`[Team] State restored from ${filePath} (v1, saved ${s.savedAt})`);
      return s.mcpServers;
    }

    // V2: load agent configs from global store, histories from snapshot
    const s = snapshot as TeamSnapshotV2;
    let loadedCount = 0;
    for (const agentId of s.agentIds) {
      const def = this.agentStore?.get(agentId);
      if (!def) {
        log.warn(`[Team] Agent "${agentId}" not found in global store — skipping`);
        continue;
      }
      const provider = providerFactory(def.providerName);
      const config: AgentConfig = {
        id:                    def.id,
        identity:              def.identity,
        hatType:               def.hatType,
        provider,
        model:                 def.model,
        teamContext:           def.teamContext,
        enabledMcpServers:     def.enabledMcpServers,
        personalMcpCredentials: def.personalMcpCredentials,
      };
      const agent = this.registerAgent(config);
      agent.setHistory(s.agentHistories[agentId] ?? []);
      loadedCount++;
    }
    for (const task of s.tasks) this.tasks.set(task.id, task);
    for (const meeting of s.meetings) this.meetings.set(meeting.id, meeting);
    if (s.humanName) this.humanName = s.humanName;
    await this.store.append('state_loaded', { path: filePath, agentCount: loadedCount });
    log.info(`[Team] State restored from ${filePath} (v2, saved ${s.savedAt})`);
    return s.mcpServers;
  }

  // ── Agent registration ─────────────────────────────────────────────────────

  setTelemetryRecorder(fn: NonNullable<typeof this.telemetryRecorder>): void {
    this.telemetryRecorder = fn;
    for (const agent of this.agents.values()) agent.setTelemetryRecorder(fn);
  }

  setHumanMeetingTurnHandler(fn: NonNullable<typeof this.onHumanMeetingTurn>): void {
    this.onHumanMeetingTurn = fn;
  }

  setMeetingTurnPacer(fn: NonNullable<typeof this.onMeetingTurnPaced>): void {
    this.onMeetingTurnPaced = fn;
  }

  setEmailAllowlistStore(store: EmailAllowlistStore | null): void {
    this.emailAllowlistRef.store = store;
  }

  async enablePersonalMcp(agentName: string, serverId: string, credentials: Record<string, string>): Promise<void> {
    const agent = this.requireAgent(agentName);
    const entry = getCatalogue().find(e => e.id === serverId && e.personal);
    if (!entry) throw new Error(`"${serverId}" is not a personal MCP catalogue entry.`);
    if (!agent.config.personalMcpCredentials) agent.config.personalMcpCredentials = {};
    agent.config.personalMcpCredentials[serverId] = credentials;
    await this.startPersonalMcp(agentName, serverId, credentials);
  }

  async disablePersonalMcp(agentName: string, serverId: string): Promise<void> {
    const agent = this.requireAgent(agentName);
    if (agent.config.personalMcpCredentials) {
      delete agent.config.personalMcpCredentials[serverId];
      if (Object.keys(agent.config.personalMcpCredentials).length === 0) {
        delete agent.config.personalMcpCredentials;
      }
    }
    const personalMcp = this.personalMcpByAgent.get(agentName.toLowerCase());
    if (personalMcp?.has(serverId)) await personalMcp.disconnect(serverId);
  }

  getPersonalMcpCredentials(agentName: string): Record<string, Record<string, string>> {
    return this.findByName(agentName)?.config.personalMcpCredentials ?? {};
  }

  private async startPersonalMcp(agentName: string, serverId: string, credentials: Record<string, string>): Promise<void> {
    const entry = getCatalogue().find(e => e.id === serverId);
    if (!entry) return;
    const key = agentName.toLowerCase();
    if (!this.personalMcpByAgent.has(key)) this.personalMcpByAgent.set(key, new MCPRegistry());
    const personalMcp = this.personalMcpByAgent.get(key)!;
    if (personalMcp.has(serverId)) await personalMcp.disconnect(serverId);
    const config = resolvePersonalConfig(entry, credentials);
    await personalMcp.add({ name: serverId, config });
    log.info(`[Team] Personal MCP "${serverId}" started for ${agentName}`);
  }

  setProjectDir(dir: string | null): void {
    this.projectDir = dir;
    for (const agent of this.agents.values()) agent.updateProjectDir(dir);
  }

  setProjectGoal(goal: string | null): void {
    this.projectGoal = goal;
    for (const agent of this.agents.values()) agent.updateProjectGoal(goal);
  }

  setHumanName(name: string): void {
    this.humanName = name || 'Human';
    this.rebuildTeamContext();
  }

  registerAgent(config: AgentConfig): Agent {
    if (this.projectDir) config = { ...config, projectDir: this.projectDir };
    if (this.projectGoal) config = { ...config, projectGoal: this.projectGoal };
    const agent = new Agent(config);
    agent.setToolExecutor(buildToolExecutor(this.makeToolCallContext(), this.mcp));
    agent.setResponseHandler(makeResponseHandlerFn({
      store: this.store,
      deliverToAgent: (name, msg) => this.deliverToAgent(name, msg),
      buildMessage,
    }));
    agent.setExtraToolsProvider(() => {
      const ids         = agent.config.enabledMcpServers;
      const sharedTools = ids === undefined ? this.mcp.getAllTools() : this.mcp.getToolsForServers(ids);
      const personalMcp = this.personalMcpByAgent.get(agent.name.toLowerCase());
      if (!personalMcp) return sharedTools;
      const personalTools   = personalMcp.getAllTools();
      const personalToolNames = new Set(personalTools.map(t => t.name));
      // Only deduplicate exact name matches — shared email tools remain available for reading.
      // The system prompt directive governs which account to use when sending.
      return [...sharedTools.filter(t => !personalToolNames.has(t.name)), ...personalTools];
    });
    agent.setLLMSemaphore(this.llmSemaphore);
    if (this.telemetryRecorder) agent.setTelemetryRecorder(this.telemetryRecorder);
    this.agents.set(agent.id, agent);
    this.rebuildTeamContext();
    // Start personal MCPs from config (fire-and-forget; they connect async)
    if (config.personalMcpCredentials) {
      for (const [serverId, creds] of Object.entries(config.personalMcpCredentials)) {
        this.startPersonalMcp(agent.name, serverId, creds).catch((err: Error) => {
          log.warn(`[Team] Personal MCP "${serverId}" for ${agent.name} failed to start:`, err.message);
        });
      }
    }
    this.ensureDefaultAgenda(agent.name).catch(() => {});
    return agent;
  }

  private async ensureDefaultAgenda(agentName: string): Promise<void> {
    if (this.agendaDefaultsSeeded.has(agentName)) return;
    const store = this.agendaStoreRef.store;
    if (!store) return;
    this.agendaDefaultsSeeded.add(agentName);
    const existing = store.list(agentName);
    const hasPermissionCheck = existing.some(e =>
      e.label.toLowerCase().includes('permission') || e.label.toLowerCase().includes('approval'),
    );
    if (hasPermissionCheck) return;
    await store.add({
      agentName,
      label: 'Check email permissions',
      description: 'Call check_email_permissions to see if the human has approved any new email addresses since your last check. For each newly approved address, proceed with any email you were waiting to send to that address.',
      intervalSeconds: 600,
    });
  }

  getAgent(name: string): Agent | undefined { return this.findByName(name); }
  listAgents(): Agent[] { return Array.from(this.agents.values()); }

  /** Clear tasks and agent histories while keeping agent definitions. */
  stopAllAgents(): void {
    for (const agent of this.agents.values()) agent.stop();
  }

  clearProject(): void {
    this.tasks.clear();
    this.meetings.clear();
    for (const agent of this.agents.values()) agent.setHistory([]);
  }

  updateAgentConfig(name: string, provider: AIProvider, model: string): void {
    this.requireAgent(name).setProvider(provider, model);
  }

  changeAgentHat(name: string, hatTypes: HatType[]): void {
    this.requireAgent(name).setHat(hatTypes);
    this.rebuildTeamContext();
  }

  renameAgent(oldName: string, newName: string): void {
    const agent = this.requireAgent(oldName);
    const trimmed = newName.trim();
    if (!trimmed) throw new Error('Name cannot be empty');
    if (this.hasAgentWithName(trimmed) && trimmed !== oldName) throw new Error(`Agent "${trimmed}" already exists`);
    agent.rename(trimmed);
    this.rebuildTeamContext();
  }

  updateAgentSpecialisation(name: string, specialisation: string | undefined): void {
    this.requireAgent(name).setSpecialisation(specialisation);
    this.rebuildTeamContext();
  }

  updateAgentIdentity(name: string, visualDescription: string | undefined, backstory: string | undefined): void {
    this.requireAgent(name).setIdentity(visualDescription, backstory);
  }

  updateAgentAvatar(name: string, avatar: string | undefined): void { this.requireAgent(name).setAvatar(avatar); }
  updateAgentBackground(name: string, background: string | undefined): void { this.requireAgent(name).setBackground(background); }
  updateAgentVoice(name: string, voice: string | undefined, speakerName: string | undefined): void { this.requireAgent(name).setVoice(voice, speakerName); }
  updateAgentEmail(name: string, email: string | undefined): void { this.requireAgent(name).config.identity.email = email || undefined; }

  updateAgentMcpServers(name: string, serverIds: string[] | undefined): void {
    this.requireAgent(name).config.enabledMcpServers = serverIds;
  }

  removeAgent(name: string): void {
    const agent = this.requireAgent(name);
    this.agents.delete(agent.id);
    const personalMcp = this.personalMcpByAgent.get(name.toLowerCase());
    if (personalMcp) {
      personalMcp.disconnectAll().catch(() => {});
      this.personalMcpByAgent.delete(name.toLowerCase());
    }
    this.rebuildTeamContext();
  }

  // ── Human interface ────────────────────────────────────────────────────────

  onEvent(fn: (event: import('../store/event-store.js').StoredEvent) => void): () => void {
    return this.store.subscribe(fn);
  }

  getToolInfo() {
    const toolMeta = new Map<string, { description: string; agents: string[] }>();
    for (const agent of this.agents.values()) {
      for (const tool of getToolsForHat(agent.config.hatType)) {
        if (!toolMeta.has(tool.name)) {
          toolMeta.set(tool.name, { description: tool.description, agents: [] });
        }
        toolMeta.get(tool.name)!.agents.push(agent.name);
      }
    }
    return {
      builtin: Array.from(toolMeta.entries()).map(([name, meta]) => ({
        name,
        description: meta.description,
        agents: meta.agents,
      })),
      mcp: this.mcp.getToolsByServer(),
    };
  }

  async readEvents(since?: string): Promise<import('../store/event-store.js').StoredEvent[]> {
    return since ? this.store.readSince(since) : this.store.readAll();
  }

  onEscalation(handler: (from: string, message: string, urgency: string) => void): void {
    this.onHumanEscalation = handler;
  }

  async humanMessage(toAgentName: string, content: string): Promise<void> {
    const msg = buildMessage('human', toAgentName, 'direct', content);
    await this.store.append('human_message', { to: toAgentName, content });
    this.findByName(toAgentName)?.markHelpReceived();
    this.deliverToAgent(toAgentName, msg);
  }

  async humanAssignTask(toAgentName: string, task: string, context?: string, projectName?: string): Promise<void> {
    const taskId = await this.createTask(toAgentName, this.humanName, task, context, projectName);
    const storedTask = this.tasks.get(taskId)!;
    const folderNote = storedTask.projectFolder
      ? `\n\nA project workspace has been created for this task. Use read_file, write_file, list_files, and fetch_url to save and retrieve your work.`
      : '';
    const content = (context ? `${task}\n\nContext: ${context}` : task) + folderNote;
    const msg = buildMessage('human', toAgentName, 'task', content, { taskId });
    await this.store.append('task_assigned', { taskId, from: 'human', to: toAgentName, task, context, projectName: storedTask.projectName });
    this.deliverToAgent(toAgentName, msg);
  }

  async humanReply(toAgentName: string, content: string): Promise<void> {
    const msg = buildMessage('human', toAgentName, 'human_reply', content);
    await this.store.append('human_reply', { to: toAgentName, content });
    const agent = this.findByName(toAgentName);
    if (agent) {
      agent.markHelpReceived();
      this.deliverToAgent(toAgentName, msg);
    }
  }

  async broadcastHumanMessage(content: string): Promise<void> {
    await this.store.append('human_broadcast', { content });
    for (const agent of this.agents.values()) {
      const msg = buildMessage('human', agent.name, 'direct', content);
      agent.markHelpReceived();
      agent.interrupt(msg);
    }
  }

  humanMeetingInterjection(meetingId: string, content: string): void {
    this.activeMeetingRooms.get(meetingId)?.injectHumanMessage(content);
  }

  // ── Task / meeting getters ─────────────────────────────────────────────────

  getTask(id: string): Task | undefined { return this.tasks.get(id); }
  listTasks(): Task[] { return Array.from(this.tasks.values()); }
  getMeeting(id: string): Meeting | undefined { return this.meetings.get(id); }
  listMeetings(): Meeting[] { return Array.from(this.meetings.values()); }

  // ── Scheduled meetings ─────────────────────────────────────────────────────

  async createScheduledMeeting(data: {
    type: MeetingType; topic: string; agenda?: string;
    facilitator: string; participants: string[];
    scheduledFor: string; createdBy: string;
  }): Promise<ScheduledMeeting> {
    if (!this.scheduledMeetingStore) throw new Error('Meeting store not initialised');
    return sm.createScheduledMeeting({ store: this.store, scheduledMeetingStore: this.scheduledMeetingStore, findByName: (n) => this.findByName(n), startMeeting: (...a) => this.startMeeting(...a) }, data);
  }

  async recordImpromptuInCalendar(data: { topic: string; agenda?: string; facilitator: string; participants: string[]; startedAt: string }): Promise<void> {
    if (!this.scheduledMeetingStore) return;
    return sm.recordImpromptuInCalendar(this.scheduledMeetingStore, data);
  }

  listScheduledMeetings(): ScheduledMeeting[] {
    return this.scheduledMeetingStore ? sm.listScheduledMeetings(this.scheduledMeetingStore) : [];
  }

  async cancelScheduledMeeting(id: string): Promise<void> {
    if (!this.scheduledMeetingStore) throw new Error('Meeting store not initialised');
    return sm.cancelScheduledMeeting(this.scheduledMeetingStore, id);
  }
  async deleteScheduledMeeting(id: string): Promise<boolean> {
    if (!this.scheduledMeetingStore) return false;
    return sm.deleteScheduledMeeting(this.scheduledMeetingStore, id);
  }
  async updateScheduledMeeting(meeting: ScheduledMeeting): Promise<void> {
    if (!this.scheduledMeetingStore) return;
    return sm.updateScheduledMeeting(this.scheduledMeetingStore, meeting);
  }

  async launchScheduledMeeting(id: string): Promise<void> {
    if (!this.scheduledMeetingStore) throw new Error('Meeting store not initialised');
    return sm.launchScheduledMeeting({ store: this.store, scheduledMeetingStore: this.scheduledMeetingStore, findByName: (n) => this.findByName(n), startMeeting: (...a) => this.startMeeting(...a) }, id);
  }

  getMCPTools() { return this.mcp.getAllTools(); }
  cancelActiveMeeting(meetingId: string): boolean {
    const room = this.activeMeetingRooms.get(meetingId);
    if (!room) return false;
    room.close();
    return true;
  }
  raiseHandInMeeting(meetingId: string, participant: string, raised: boolean): void {
    this.activeMeetingRooms.get(meetingId)?.raiseHand(participant, raised);
  }
  async launchImpromptuMeeting(facilitatorName: string, participants: string[], topic: string, agenda?: string): Promise<string> {
    return this.startMeeting(facilitatorName, participants, topic, agenda);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private findByName(name: string): Agent | undefined {
    for (const agent of this.agents.values()) {
      if (agent.name === name) return agent;
    }
    return undefined;
  }

  private requireAgent(name: string): Agent {
    const agent = this.findByName(name);
    if (!agent) throw new Error(`Agent "${name}" not found`);
    return agent;
  }

  private hasAgentWithName(name: string): boolean { return this.findByName(name) !== undefined; }

  private deliverToAgent(name: string, msg: TeamMessage): void {
    deliverToAgentFn(this.agents, this.lastSenderByAgent, name, msg);
  }

  private findBlueHat(): Agent | undefined { return findBlueHatFn(this.agents); }

  private async createTask(assignedTo: string, assignedBy: string, description: string, context?: string, projectName?: string): Promise<string> {
    return createTaskFn(this.tasks, this.projectsRoot, assignedTo, assignedBy, description, context, projectName);
  }

  private resolveAgentPath(agentName: string, filePath: string): string {
    return resolveAgentPathFn(this.tasks, this.projectDir, agentName, filePath);
  }

  private async startMeeting(facilitatorName: string, participants: string[], topic: string, agenda?: string): Promise<string> {
    return startMeetingFn({
      meetings: this.meetings,
      activeMeetingRooms: this.activeMeetingRooms,
      agents: this.agents,
      store: this.store,
      projectDir: this.projectDir,
      onMeetingTurnPaced: this.onMeetingTurnPaced,
      onHumanMeetingTurn: this.onHumanMeetingTurn,
    }, facilitatorName, participants, topic, agenda);
  }

  private makeToolCallContext(): ToolCallContext {
    return {
      store: this.store,
      projectDir: this.projectDir,
      projectsRoot: this.projectsRoot,
      tasks: this.tasks,
      meetings: this.meetings,
      activeMeetingRooms: this.activeMeetingRooms,
      lastSenderByAgent: this.lastSenderByAgent,
      scheduledMeetingStore: this.scheduledMeetingStore,
      onHumanEscalation: this.onHumanEscalation,
      emailAllowlistRef: this.emailAllowlistRef,
      getPersonalMcp: (agentName) => this.personalMcpByAgent.get(agentName.toLowerCase()) ?? null,
      agendaStore: this.agendaStoreRef,
      findByName: (name) => this.findByName(name),
      findBlueHat: () => this.findBlueHat(),
      hasAgentWithName: (name) => this.hasAgentWithName(name),
      deliverToAgent: (name, msg) => this.deliverToAgent(name, msg),
      createTask: (a, b, c, d, e) => this.createTask(a, b, c, d, e),
      startMeeting: (a, b, c, d) => this.startMeeting(a, b, c, d),
      createScheduledMeeting: (data) => this.createScheduledMeeting(data),
      resolveAgentPath: (agentName, fp) => this.resolveAgentPath(agentName, fp),
    };
  }

  private rebuildTeamContext(): void {
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    this.rebuildTimer = setTimeout(() => {
      this.rebuildTimer = null;
      this.doRebuildTeamContext();
    }, 50);
  }

  private doRebuildTeamContext(): void {
    const roster = Array.from(this.agents.values())
      .map((a) => {
        const hats = a.config.hatType;
        const spec = a.config.identity.specialisation;
        const hatLabel = hats.filter(h => h !== 'none').map(h => h.charAt(0).toUpperCase() + h.slice(1)).join(' + ') || 'No Hat';
        return `- ${a.name} (${hatLabel})${spec ? ` — ${spec}` : ''}`;
      })
      .join('\n');

    const context = `Your team:\n${roster}\n- ${this.humanName} (Human team lead — makes final decisions)`;
    for (const agent of this.agents.values()) {
      agent.updateTeamContext(context);
    }
  }
}

