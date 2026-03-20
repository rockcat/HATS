import { v4 as uuidv4 } from 'uuid';
import { renderMarkdown } from '../human/markdown.js';
import { Agent } from '../agent/agent.js';
import { AgentConfig } from '../agent/types.js';
import { HatType } from '../hats/types.js';
import { ToolCall } from '../providers/types.js';
import { EventStore } from '../store/event-store.js';
import { MCPRegistry } from '../mcp/mcp-registry.js';
import { MCPServerDef } from '../mcp/mcp-client.js';
import { MeetingRoom } from './meeting-room.js';
import { TeamMessage, Task, Meeting, MeetingTurn } from './types.js';

export interface OrchestratorConfig {
  storePath?: string;           // path to JSONL event log; default './team-events.jsonl'
  humanName?: string;           // how the human appears in messages; default 'Human'
  maxTasksPerAgent?: number;    // soft cap; default 5
}

export class TeamOrchestrator {
  private agents: Map<string, Agent> = new Map();
  private tasks: Map<string, Task> = new Map();
  private meetings: Map<string, Meeting> = new Map();
  private activeMeetingRooms: Map<string, MeetingRoom> = new Map();
  private store: EventStore;
  private humanName: string;
  private onHumanEscalation: ((from: string, message: string, urgency: string) => void) | null = null;
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private mcp = new MCPRegistry();

  constructor(config: OrchestratorConfig = {}) {
    this.store = new EventStore(config.storePath ?? './team-events.jsonl');
    this.humanName = config.humanName ?? 'Human';
  }

  async init(): Promise<void> {
    await this.store.init();
    await this.store.append('session_start', { humanName: this.humanName });
  }

  /** Connect to an MCP server. Call before or after registering agents — tools merge automatically. */
  async addMCPServer(def: MCPServerDef): Promise<void> {
    await this.mcp.add(def);
    await this.store.append('mcp_server_added', { name: def.name });
    // Rebuild agent contexts so they see the new tools in their next turn
    this.rebuildTeamContext();
  }

  async shutdown(): Promise<void> {
    await this.mcp.disconnectAll();
    await this.store.append('session_end', {});
  }

  // ── Agent registration ────────────────────────────────────────────────────

  registerAgent(config: AgentConfig): Agent {
    const agent = new Agent(config);
    agent.setToolExecutor(this.makeToolExecutor());
    agent.setResponseHandler(this.makeResponseHandler());
    agent.setExtraToolsProvider(() => this.mcp.getAllTools());
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

  // ── Human interface wiring ────────────────────────────────────────────────

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
  async humanAssignTask(toAgentName: string, task: string, context?: string): Promise<void> {
    const taskId = await this.createTask(toAgentName, this.humanName, task, context);
    const content = context ? `${task}\n\nContext: ${context}` : task;
    const msg = this.buildMessage('human', toAgentName, 'task', content, { taskId });
    await this.store.append('task_assigned', { taskId, from: 'human', to: toAgentName, task, context });
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
        const { agent, task, context } = call.arguments as { agent: string; task: string; context?: string };
        const target = this.agents.get(agent);
        if (!target) return `No agent named "${agent}" on this team.`;
        const taskId = await this.createTask(agent, agentName, task, context);
        const content = context ? `${task}\n\nContext: ${context}` : task;
        const msg = this.buildMessage(agentName, agent, 'task', content, { taskId });
        await this.store.append('task_assigned', { taskId, from: agentName, to: agent, task, context });
        this.deliverToAgent(agent, msg);
        return `Task assigned to ${agent}.`;
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
  ): Promise<string> {
    const taskId = uuidv4();
    const task: Task = {
      id: taskId,
      assignedTo,
      assignedBy,
      description,
      context,
      status: 'active',
      createdAt: new Date().toISOString(),
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
