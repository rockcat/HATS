import { v4 as uuidv4 } from 'uuid';
import { readFile, writeFile, readdir, mkdir } from 'fs/promises';
import * as path from 'path';
import { renderMarkdown } from '../human/markdown.js';
import { Agent } from '../agent/agent.js';
import { AgentConfig, AgentMessage } from '../agent/types.js';
import { HatType } from '../hats/types.js';
import { getToolsForHat } from '../tools/definitions.js';
import { AIProvider, ToolCall } from '../providers/types.js';
import { EventStore } from '../store/event-store.js';
import { MCPRegistry } from '../mcp/mcp-registry.js';
import { MCPServerDef } from '../mcp/mcp-client.js';
import { Semaphore } from '../providers/semaphore.js';
import { TeamSnapshot, AgentSnapshot, SNAPSHOT_VERSION } from '../store/team-snapshot.js';
import { MeetingRoom } from './meeting-room.js';
import { TeamMessage, Task, Meeting, MeetingTurn, ScheduledMeeting, MeetingType } from './types.js';
import { MeetingStore } from './meeting-store.js';

/** Called during loadState to reconstruct a provider from its saved name. */
export type ProviderFactory = (providerName: string) => AIProvider;

export interface OrchestratorConfig {
  storePath?: string;           // path to JSONL event log; default './team-events.jsonl'
  humanName?: string;           // how the human appears in messages; default 'Human'
  maxTasksPerAgent?: number;    // soft cap; default 5
  projectsRoot?: string;        // root folder for project workspaces; default './projects'
  llmConcurrency?: number;      // max simultaneous LLM calls; default 2
  llmCallIntervalMs?: number;   // min ms between each LLM call starting; default 3000
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
  private onHumanEscalation: ((from: string, message: string, urgency: string) => void) | null = null;
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private mcp = new MCPRegistry();
  private llmSemaphore: Semaphore;

  constructor(config: OrchestratorConfig = {}) {
    this.store = new EventStore(config.storePath ?? './team-events.jsonl');
    this.humanName = config.humanName ?? 'Human';
    this.projectsRoot = path.resolve(config.projectsRoot ?? './projects');
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

  /** Wire up the scheduled-meeting store so agents can schedule meetings. */
  async initMeetingStore(filePath: string): Promise<void> {
    this.scheduledMeetingStore = new MeetingStore(filePath);
    await this.scheduledMeetingStore.load();
  }

  /** Connect to an MCP server. Call before or after registering agents — tools merge automatically. */
  async addMCPServer(def: MCPServerDef): Promise<void> {
    await this.mcp.add(def);
    await this.store.append('mcp_server_added', { name: def.name });
    // Rebuild agent contexts so they see the new tools in their next turn
    this.rebuildTeamContext();
  }

  /** Disconnect and remove an MCP server. Agents will lose those tools on their next turn. */
  async removeMCPServer(name: string): Promise<void> {
    await this.mcp.disconnect(name);
    await this.store.append('mcp_server_removed', { name });
  }

  /** Returns true if an MCP server with this name is currently connected. */
  hasMCPServer(name: string): boolean {
    return this.mcp.has(name);
  }

  /** Clear all agents, tasks, and meetings (use before loadState to do a full reload). */
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

  // ── State persistence ─────────────────────────────────────────────────────

  /** Save full team state to a JSON file. */
  async saveState(path: string): Promise<void> {
    const agentSnapshots: AgentSnapshot[] = Array.from(this.agents.values()).map((agent) => ({
      identity: agent.config.identity,
      hatType: agent.config.hatType,
      model: agent.config.model,
      providerName: agent.config.provider.name,
      teamContext: agent.config.teamContext,
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

    await writeFile(path, JSON.stringify(snapshot, null, 2), 'utf-8');
    await this.store.append('state_saved', { path, agentCount: agentSnapshots.length });
    console.log(`\n[Team] State saved to ${path}`);
  }

  /**
   * Restore team state from a snapshot file.
   * Call after init() but before the CLI starts.
   * The providerFactory maps a saved providerName back to a live AIProvider instance.
   * Returns the list of MCPServerDef that were in the snapshot so the caller can
   * decide whether to reconnect them (they are NOT reconnected automatically — call
   * addMCPServer yourself if you want them back).
   */
  async loadState(path: string, providerFactory: ProviderFactory): Promise<MCPServerDef[]> {
    const raw = await readFile(path, 'utf-8');
    const snapshot = JSON.parse(raw) as TeamSnapshot;

    if (snapshot.version !== SNAPSHOT_VERSION) {
      throw new Error(`Snapshot version mismatch: expected ${SNAPSHOT_VERSION}, got ${snapshot.version}`);
    }

    // Restore agents
    for (const snap of snapshot.agents) {
      const provider = providerFactory(snap.providerName);
      const config: AgentConfig = {
        identity: snap.identity,
        hatType: snap.hatType,
        provider,
        model: snap.model,
        teamContext: snap.teamContext,
      };
      const agent = this.registerAgent(config);
      agent.setHistory(snap.history);
    }

    // Restore tasks
    for (const task of snapshot.tasks) {
      this.tasks.set(task.id, task);
    }

    // Restore meeting records (read-only history — rooms are not re-opened)
    for (const meeting of snapshot.meetings) {
      this.meetings.set(meeting.id, meeting);
    }

    await this.store.append('state_loaded', { path, agentCount: snapshot.agents.length });
    console.log(`[Team] State restored from ${path} (saved ${snapshot.savedAt})`);

    return snapshot.mcpServers;
  }

  // ── Agent registration ────────────────────────────────────────────────────

  registerAgent(config: AgentConfig): Agent {
    const agent = new Agent(config);
    agent.setToolExecutor(this.makeToolExecutor());
    agent.setResponseHandler(this.makeResponseHandler());
    agent.setExtraToolsProvider(() => this.mcp.getAllTools());
    agent.setLLMSemaphore(this.llmSemaphore);
    this.agents.set(agent.name, agent);
    this.rebuildTeamContext();
    return agent;
  }

  getAgent(name: string): Agent | undefined {
    return this.agents.get(name);
  }

  listAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  /** Hot-swap the LLM provider and model for a named agent. */
  updateAgentConfig(name: string, provider: AIProvider, model: string): void {
    const agent = this.agents.get(name);
    if (!agent) throw new Error(`Agent "${name}" not found`);
    agent.setProvider(provider, model);
  }

  /** Change an agent's thinking hat and rebuild their system prompt. */
  changeAgentHat(name: string, hatType: HatType): void {
    const agent = this.agents.get(name);
    if (!agent) throw new Error(`Agent "${name}" not found`);
    agent.setHat(hatType);
    this.rebuildTeamContext();
  }

  /** Remove an agent from the team. */
  removeAgent(name: string): void {
    if (!this.agents.has(name)) throw new Error(`Agent "${name}" not found`);
    this.agents.delete(name);
    this.rebuildTeamContext();
  }

  // ── Human interface wiring ────────────────────────────────────────────────

  /** Subscribe to every event appended to the event log. Returns unsubscribe fn. */
  onEvent(fn: (event: import('../store/event-store.js').StoredEvent) => void): () => void {
    return this.store.subscribe(fn);
  }

  /**
   * Returns built-in tools (grouped by hat) and MCP tools (grouped by server).
   * Used by the UI tools panel.
   */
  getToolInfo() {
    // Built-in: collect every unique tool, note which agents have it
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

  /** Read events from the log (for API / replay). */
  async readEvents(since?: string): Promise<import('../store/event-store.js').StoredEvent[]> {
    return since ? this.store.readSince(since) : this.store.readAll();
  }

  /** Called by CLI when human escalations need surfacing. */
  onEscalation(handler: (from: string, message: string, urgency: string) => void): void {
    this.onHumanEscalation = handler;
  }

  /** Human sends a direct message to an agent. */
  async humanMessage(toAgentName: string, content: string): Promise<void> {
    const msg = this.buildMessage('human', toAgentName, 'direct', content);
    await this.store.append('human_message', { to: toAgentName, content });
    this.deliverToAgent(toAgentName, msg);
  }

  /** Human assigns a task directly (usually to Blue Hat). */
  async humanAssignTask(toAgentName: string, task: string, context?: string, projectName?: string): Promise<void> {
    const taskId = await this.createTask(toAgentName, this.humanName, task, context, projectName);
    const storedTask = this.tasks.get(taskId)!;
    const folderNote = storedTask.projectFolder
      ? `\n\nProject folder: ${storedTask.projectFolder}\nUse read_file, write_file, and list_files to save and retrieve work there.`
      : '';
    const content = (context ? `${task}\n\nContext: ${context}` : task) + folderNote;
    const msg = this.buildMessage('human', toAgentName, 'task', content, { taskId });
    await this.store.append('task_assigned', { taskId, from: 'human', to: toAgentName, task, context, projectName: storedTask.projectName });
    this.deliverToAgent(toAgentName, msg);
  }

  /** Human responds to an escalation or ongoing conversation. */
  async humanReply(toAgentName: string, content: string): Promise<void> {
    const msg = this.buildMessage('human', toAgentName, 'human_reply', content);
    await this.store.append('human_reply', { to: toAgentName, content });
    const agent = this.agents.get(toAgentName);
    if (agent) {
      agent.markHelpReceived();
      this.deliverToAgent(toAgentName, msg);
    }
  }

  /** Human injects a message into an active meeting. */
  humanMeetingInterjection(meetingId: string, content: string): void {
    this.activeMeetingRooms.get(meetingId)?.injectHumanMessage(content);
  }

  // ── Task management ───────────────────────────────────────────────────────

  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  listTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  getMeeting(id: string): Meeting | undefined {
    return this.meetings.get(id);
  }

  listMeetings(): Meeting[] {
    return Array.from(this.meetings.values());
  }

  // ── Scheduled meetings ────────────────────────────────────────────────────

  async createScheduledMeeting(data: {
    type: MeetingType;
    topic: string;
    agenda?: string;
    facilitator: string;
    participants: string[];
    scheduledFor: string;
    createdBy: string;
  }): Promise<ScheduledMeeting> {
    if (!this.scheduledMeetingStore) throw new Error('Meeting store not initialised');
    const meeting: ScheduledMeeting = {
      id: uuidv4(),
      ...data,
      status: 'scheduled',
      createdAt: new Date().toISOString(),
    };
    await this.scheduledMeetingStore.add(meeting);
    await this.store.append('meeting_scheduled', { id: meeting.id, topic: data.topic, scheduledFor: data.scheduledFor, facilitator: data.facilitator });
    return meeting;
  }

  listScheduledMeetings(): ScheduledMeeting[] {
    return this.scheduledMeetingStore?.list() ?? [];
  }

  async cancelScheduledMeeting(id: string): Promise<void> {
    if (!this.scheduledMeetingStore) throw new Error('Meeting store not initialised');
    const meeting = this.scheduledMeetingStore.get(id);
    if (!meeting) throw new Error(`Scheduled meeting "${id}" not found`);
    if (meeting.status !== 'scheduled') throw new Error(`Meeting "${id}" is already ${meeting.status}`);
    meeting.status = 'cancelled';
    meeting.cancelledAt = new Date().toISOString();
    await this.scheduledMeetingStore.update(meeting);
  }

  /** Launch a scheduled meeting immediately (called by the auto-start timer or manually). */
  async launchScheduledMeeting(id: string): Promise<void> {
    if (!this.scheduledMeetingStore) throw new Error('Meeting store not initialised');
    const scheduled = this.scheduledMeetingStore.get(id);
    if (!scheduled) throw new Error(`Scheduled meeting "${id}" not found`);
    if (scheduled.status !== 'scheduled') return; // already launched or cancelled

    const facilitator = this.agents.get(scheduled.facilitator);
    if (!facilitator) throw new Error(`Facilitator "${scheduled.facilitator}" not found`);

    await this.startMeeting(scheduled.facilitator, scheduled.participants, scheduled.topic, scheduled.agenda);

    scheduled.status = 'launched';
    scheduled.launchedAt = new Date().toISOString();
    await this.scheduledMeetingStore.update(scheduled);
  }

  // ── Tool executor ─────────────────────────────────────────────────────────

  private makeToolExecutor() {
    return async (agentName: string, call: ToolCall): Promise<string> => {
      await this.store.append('tool_call', { agent: agentName, tool: call.name, args: call.arguments });

      try {
        const result = this.mcp.isMCPTool(call.name)
          ? await this.mcp.callTool(call.name, call.arguments)
          : await this.executeToolCall(agentName, call);
        await this.store.append('tool_result', { agent: agentName, tool: call.name, result });
        return result;
      } catch (err) {
        const error = (err as Error).message;
        await this.store.append('tool_error', { agent: agentName, tool: call.name, error });
        return `Error: ${error}`;
      }
    };
  }

  /** MCP tools merged with built-in tools — exposed so agents can include them in requests. */
  getMCPTools() {
    return this.mcp.getAllTools();
  }

  private async executeToolCall(agentName: string, call: ToolCall): Promise<string> {
    switch (call.name) {
      case 'send_message': {
        const { to, message } = call.arguments as { to: string; message: string };
        const target = this.agents.get(to);
        if (!target) return `No agent named "${to}" on this team.`;
        if (!message || !message.trim()) return `Message content is empty — call was rejected. Please include the full message content in the "message" argument and retry.`;
        const msg = this.buildMessage(agentName, to, 'direct', message);
        await this.store.append('direct_message', { from: agentName, to, content: message });
        this.deliverToAgent(to, msg);
        return `Message sent to ${to}.`;
      }

      case 'escalate_to_human': {
        const { message, urgency } = call.arguments as { message: string; urgency: 'low' | 'high' };
        const agent = this.agents.get(agentName);
        agent?.markBlocked();
        await this.store.append('escalation', { from: agentName, urgency, message });
        this.onHumanEscalation?.(agentName, message, urgency);
        return `Escalation raised. Waiting for human response.`;
      }

      case 'report_task_complete': {
        const { summary } = call.arguments as { summary: string };
        const agent = this.agents.get(agentName);
        agent?.markTaskComplete();

        // Update any active task for this agent
        for (const task of this.tasks.values()) {
          if (task.assignedTo === agentName && task.status === 'active') {
            task.status = 'complete';
            task.completedAt = new Date().toISOString();
            task.summary = summary;
            break;
          }
        }

        await this.store.append('task_complete', { agent: agentName, summary });

        // Notify Blue Hat that the task is done
        const blueHat = this.findBlueHat();
        if (blueHat && blueHat.name !== agentName) {
          const msg = this.buildMessage(agentName, blueHat.name, 'task_complete', summary);
          this.deliverToAgent(blueHat.name, msg);
        }

        return `Task marked complete.`;
      }

      case 'assign_task': {
        const { agent, task, context, projectName } = call.arguments as { agent: string; task: string; context?: string; projectName?: string };
        const target = this.agents.get(agent);
        if (!target) return `No agent named "${agent}" on this team.`;
        const taskId = await this.createTask(agent, agentName, task, context, projectName);
        const storedTask = this.tasks.get(taskId)!;
        const folderNote = storedTask.projectFolder
          ? `\n\nProject folder: ${storedTask.projectFolder}\nUse read_file, write_file, and list_files to save and retrieve work there.`
          : '';
        const content = (context ? `${task}\n\nContext: ${context}` : task) + folderNote;
        const msg = this.buildMessage(agentName, agent, 'task', content, { taskId });
        await this.store.append('task_assigned', { taskId, from: agentName, to: agent, task, context, projectName: storedTask.projectName });
        this.deliverToAgent(agent, msg);
        return `Task assigned to ${agent}. Project folder: ${storedTask.projectFolder ?? 'none'}`;
      }

      case 'request_meeting': {
        const { participants, topic, agenda } = call.arguments as {
          participants: string[];
          topic: string;
          agenda?: string;
        };
        // Validate participants
        const invalid = participants.filter((p) => p !== 'human' && !this.agents.has(p));
        if (invalid.length > 0) return `Unknown participants: ${invalid.join(', ')}`;

        await this.startMeeting(agentName, participants, topic, agenda);
        return `Meeting "${topic}" started.`;
      }

      case 'schedule_meeting': {
        const { type, participants, topic, agenda, scheduledFor } = call.arguments as {
          type: MeetingType;
          participants: string[];
          topic: string;
          agenda?: string;
          scheduledFor: string;
        };
        if (!this.scheduledMeetingStore) return 'Meeting scheduling is not available in this project.';
        const invalid = participants.filter((p) => p !== 'human' && !this.agents.has(p));
        if (invalid.length > 0) return `Unknown participants: ${invalid.join(', ')}`;
        const when = new Date(scheduledFor);
        if (isNaN(when.getTime())) return `Invalid scheduledFor date: "${scheduledFor}". Use ISO-8601 format, e.g. "2026-04-01T09:00:00".`;
        if (when <= new Date()) return `scheduledFor must be in the future.`;
        const scheduled = await this.createScheduledMeeting({
          type,
          topic,
          agenda,
          facilitator: agentName,
          participants,
          scheduledFor: when.toISOString(),
          createdBy: agentName,
        });
        return `Meeting "${topic}" scheduled for ${when.toLocaleString()} (id: ${scheduled.id}).`;
      }

      case 'read_file': {
        const { path: filePath } = call.arguments as { path: string };
        const resolved = path.resolve(filePath);
        try {
          const content = await readFile(resolved, 'utf-8');
          return content;
        } catch (err) {
          return `Error reading file: ${(err as Error).message}`;
        }
      }

      case 'write_file': {
        const { path: filePath, content } = call.arguments as { path: string; content: string };
        const resolved = path.resolve(filePath);
        try {
          await mkdir(path.dirname(resolved), { recursive: true });
          await writeFile(resolved, content, 'utf-8');
          return `File written: ${resolved}`;
        } catch (err) {
          return `Error writing file: ${(err as Error).message}`;
        }
      }

      case 'list_files': {
        const { directory } = call.arguments as { directory?: string };
        const resolved = path.resolve(directory ?? '.');
        try {
          const entries = await readdir(resolved, { withFileTypes: true });
          const lines = entries.map(e => `${e.isDirectory() ? '[dir] ' : '      '}${e.name}`);
          return lines.length ? lines.join('\n') : '(empty directory)';
        } catch (err) {
          return `Error listing directory: ${(err as Error).message}`;
        }
      }

      case 'web_search': {
        const { query, count = 5 } = call.arguments as { query: string; count?: number };
        const apiKey = process.env.BRAVE_SEARCH_API_KEY;
        if (!apiKey) {
          return 'web_search requires the BRAVE_SEARCH_API_KEY environment variable to be set. Get a free key at https://brave.com/search/api/';
        }
        try {
          const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(count, 10)}`;
          const resp = await fetch(url, {
            headers: { 'Accept': 'application/json', 'X-Subscription-Token': apiKey },
          });
          if (!resp.ok) return `Search API error: ${resp.status} ${resp.statusText}`;
          const data = await resp.json() as { web?: { results?: Array<{ title: string; url: string; description?: string }> } };
          const results = data.web?.results ?? [];
          if (results.length === 0) return 'No results found.';
          return results.map((r, i) =>
            `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.description ?? ''}`,
          ).join('\n\n');
        } catch (err) {
          return `Search error: ${(err as Error).message}`;
        }
      }

      default:
        return `Unknown tool: ${call.name}`;
    }
  }

  // ── Response handler ──────────────────────────────────────────────────────

  private makeResponseHandler() {
    return async (agentName: string, incomingMessage: TeamMessage, response: string): Promise<void> => {
      await this.store.append('agent_response', {
        from: agentName,
        inReplyTo: incomingMessage.id,
        content: response,
      });

      // Route reply: if message came from human, surface it
      if (incomingMessage.from === 'human') {
        console.log(`\n\x1b[1m${agentName}\x1b[0m\n${renderMarkdown(response)}`);
      } else if (incomingMessage.from !== agentName) {
        // Route reply back to sender
        const replyMsg = this.buildMessage(agentName, incomingMessage.from, 'direct', response);
        this.deliverToAgent(incomingMessage.from, replyMsg);
      }
    };
  }

  // ── Meetings ──────────────────────────────────────────────────────────────

  private async startMeeting(
    facilitatorName: string,
    participants: string[],
    topic: string,
    agenda?: string,
  ): Promise<void> {
    const meetingId = uuidv4();
    const meeting: Meeting = {
      id: meetingId,
      topic,
      agenda,
      facilitator: facilitatorName,
      participants,
      status: 'open',
      turns: [],
      createdAt: new Date().toISOString(),
    };
    this.meetings.set(meetingId, meeting);

    await this.store.append('meeting_started', {
      meetingId,
      facilitator: facilitatorName,
      participants,
      topic,
      agenda,
    });

    console.log(`\n━━━ MEETING: ${topic} ━━━`);
    console.log(`Participants: ${[facilitatorName, ...participants].join(', ')}\n`);

    // Notify all participants
    for (const p of participants) {
      if (p !== 'human') {
        const agent = this.agents.get(p);
        if (agent) {
          const inviteMsg = this.buildMessage(facilitatorName, p, 'meeting_invite',
            `You are invited to a meeting: "${topic}". ${agenda ? 'Agenda: ' + agenda : ''}`,
            { meetingId },
          );
          agent.receive(inviteMsg);
        }
      }
    }

    const room = new MeetingRoom(
      meeting,
      this.agents,
      this.store,
      (transcript: MeetingTurn[], meetingTopic: string) =>
        this.getHumanMeetingInput(transcript, meetingTopic),
    );

    // Wire up close signal — when facilitator calls report_task_complete inside meeting
    this.activeMeetingRooms.set(meetingId, room);

    // Run async so agent tool loop can return
    room.run().then(() => {
      this.activeMeetingRooms.delete(meetingId);
    }).catch((err) => {
      console.error(`[Meeting ${meetingId}] error:`, err);
      this.activeMeetingRooms.delete(meetingId);
    });
  }

  private async getHumanMeetingInput(turns: MeetingTurn[], topic: string): Promise<string | null> {
    // Delegated to CLI interface — returns null if human passes
    console.log(`\n[Meeting: ${topic}] Your turn (press Enter to pass):`);
    return null; // CLI overrides this via onHumanMeetingTurn
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private buildMessage(
    from: string,
    to: string,
    type: TeamMessage['type'],
    content: string,
    extras: Partial<TeamMessage> = {},
  ): TeamMessage {
    return {
      id: uuidv4(),
      ts: new Date().toISOString(),
      type,
      from,
      to,
      content,
      ...extras,
    };
  }

  private deliverToAgent(name: string, message: TeamMessage): void {
    const agent = this.agents.get(name);
    if (agent) {
      agent.receive(message);
    } else {
      console.warn(`[Orchestrator] No agent "${name}" to deliver message to`);
    }
  }

  private async createTask(
    assignedTo: string,
    assignedBy: string,
    description: string,
    context?: string,
    projectName?: string,
  ): Promise<string> {
    const taskId = uuidv4();
    const slug = projectName
      ? toProjectSlug(projectName)
      : toProjectSlug(description);
    const projectFolder = path.join(this.projectsRoot, slug);

    try {
      await mkdir(projectFolder, { recursive: true });
    } catch {
      // ignore if already exists
    }

    const task: Task = {
      id: taskId,
      assignedTo,
      assignedBy,
      description,
      context,
      status: 'active',
      createdAt: new Date().toISOString(),
      projectName: slug,
      projectFolder,
    };
    this.tasks.set(taskId, task);
    return taskId;
  }

  private findBlueHat(): Agent | undefined {
    return Array.from(this.agents.values()).find((a) => a.hatType === HatType.Blue);
  }

  private rebuildTeamContext(): void {
    // Debounce — if multiple agents are registered in quick succession,
    // only rebuild once after the last one is added.
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function toProjectSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')   // keep dashes so TKT-001 stays tkt-001
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .join('-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'project';
}
