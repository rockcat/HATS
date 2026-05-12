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
import { TeamSnapshot, AgentSnapshot, SNAPSHOT_VERSION } from '../store/team-snapshot.js';
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
    await this.mcp.disconnectAll();
    await this.store.append('session_end', {});
  }

  // ── State persistence ──────────────────────────────────────────────────────

  async saveState(filePath: string): Promise<void> {
    const agentSnapshots: AgentSnapshot[] = Array.from(this.agents.values()).map((agent) => ({
      id: agent.id,
      identity: agent.config.identity,
      hatType: agent.config.hatType,
      model: agent.config.model,
      providerName: agent.config.provider.name,
      teamContext: agent.config.teamContext,
      enabledMcpServers: agent.config.enabledMcpServers,
      history: agent.getHistory().map((m) => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : String(m.timestamp),
        toolCalls: m.toolCalls,
        toolCallId: m.toolCallId,
        toolName: m.toolName,
      })),
    }));

    const snapshot: TeamSnapshot = {
      version: SNAPSHOT_VERSION,
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

    if (snapshot.version !== SNAPSHOT_VERSION) {
      throw new Error(`Snapshot version mismatch: expected ${SNAPSHOT_VERSION}, got ${snapshot.version}`);
    }

    for (const snap of snapshot.agents) {
      const provider = providerFactory(snap.providerName);
      const config: AgentConfig = {
        id: snap.id,
        identity: snap.identity,
        hatType: snap.hatType,
        provider,
        model: snap.model,
        teamContext: snap.teamContext,
        enabledMcpServers: snap.enabledMcpServers,
      };
      const agent = this.registerAgent(config);
      agent.setHistory(snap.history);
    }

    for (const task of snapshot.tasks) this.tasks.set(task.id, task);
    for (const meeting of snapshot.meetings) this.meetings.set(meeting.id, meeting);
    if (snapshot.humanName) this.humanName = snapshot.humanName;

    await this.store.append('state_loaded', { path: filePath, agentCount: snapshot.agents.length });
    log.info(`[Team] State restored from ${filePath} (saved ${snapshot.savedAt})`);
    return snapshot.mcpServers;
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
      const ids = agent.config.enabledMcpServers;
      return ids === undefined ? this.mcp.getAllTools() : this.mcp.getToolsForServers(ids);
    });
    agent.setLLMSemaphore(this.llmSemaphore);
    if (this.telemetryRecorder) agent.setTelemetryRecorder(this.telemetryRecorder);
    this.agents.set(agent.id, agent);
    this.rebuildTeamContext();
    return agent;
  }

  getAgent(name: string): Agent | undefined { return this.findByName(name); }
  listAgents(): Agent[] { return Array.from(this.agents.values()); }

  updateAgentConfig(name: string, provider: AIProvider, model: string): void {
    this.requireAgent(name).setProvider(provider, model);
  }

  changeAgentHat(name: string, hatType: HatType): void {
    this.requireAgent(name).setHat(hatType);
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

  updateAgentAvatar(name: string, avatar: string | undefined): void { this.requireAgent(name).setAvatar(avatar); }
  updateAgentBackground(name: string, background: string | undefined): void { this.requireAgent(name).setBackground(background); }
  updateAgentVoice(name: string, voice: string | undefined, speakerName: string | undefined): void { this.requireAgent(name).setVoice(voice, speakerName); }

  updateAgentMcpServers(name: string, serverIds: string[] | undefined): void {
    this.requireAgent(name).config.enabledMcpServers = serverIds;
  }

  removeAgent(name: string): void {
    const agent = this.requireAgent(name);
    this.agents.delete(agent.id);
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
      ? `\n\nProject folder: ${storedTask.projectFolder}\nUse read_file, write_file, and list_files to save and retrieve work there.`
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
        const hat = a.config.hatType;
        const spec = a.config.identity.specialisation;
        const hatLabel = hat.charAt(0).toUpperCase() + hat.slice(1);
        return `- ${a.name} (${hatLabel} Hat)${spec ? ` — ${spec}` : ''}`;
      })
      .join('\n');

    const context = `Your team:\n${roster}\n- ${this.humanName} (Human team lead — makes final decisions)`;
    for (const agent of this.agents.values()) {
      agent.updateTeamContext(context);
    }
  }
}
