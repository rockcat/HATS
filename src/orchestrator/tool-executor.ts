import * as path from 'path';
import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { MCPRegistry } from '../mcp/mcp-registry.js';
import { EventStore } from '../store/event-store.js';
import { ToolCall } from '../providers/types.js';
import { AgendaStore } from '../api/agenda-store.js';
import { Agent } from '../agent/agent.js';
import { Task, Meeting, TeamMessage, ScheduledMeeting, MeetingType } from './types.js';
import { MeetingRoom } from './meeting-room.js';
import { MeetingStore } from './meeting-store.js';
import { buildMessage } from './orchestrator-utils.js';
import { EmailAllowlistStore } from '../api/email-allowlist-store.js';

export interface ToolCallContext {
  store: EventStore;
  projectDir: string | null;
  projectsRoot: string;
  tasks: Map<string, Task>;
  meetings: Map<string, Meeting>;
  activeMeetingRooms: Map<string, MeetingRoom>;
  lastSenderByAgent: Map<string, string>;
  scheduledMeetingStore: MeetingStore | null;
  onHumanEscalation: ((from: string, message: string, urgency: string) => void) | null;
  /** Mutable wrapper so the store reference stays live after context creation. */
  emailAllowlistRef: { store: EmailAllowlistStore | null };
  /** Returns the personal MCPRegistry for the given agent, or null if they have none. */
  getPersonalMcp(agentName: string): MCPRegistry | null;
  /** Mutable ref so the store stays live after context creation. */
  agendaStore: { store: AgendaStore | null };
  findByName(name: string): Agent | undefined;
  findBlueHat(): Agent | undefined;
  hasAgentWithName(name: string): boolean;
  deliverToAgent(name: string, msg: TeamMessage): void;
  createTask(assignedTo: string, assignedBy: string, description: string, context?: string, projectName?: string): Promise<string>;
  startMeeting(facilitatorName: string, participants: string[], topic: string, agenda?: string): Promise<string>;
  createScheduledMeeting(data: {
    type: MeetingType; topic: string; agenda?: string;
    facilitator: string; participants: string[];
    scheduledFor: string; createdBy: string;
  }): Promise<ScheduledMeeting>;
  resolveAgentPath(agentName: string, filePath: string): string;
}

const EMAIL_STANDALONE_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;

function extractEmailsFromArgs(args: Record<string, unknown>): string[] {
  const emails = new Set<string>();
  const scan = (v: unknown): void => {
    if (typeof v === 'string') {
      const trimmed = v.trim();
      if (EMAIL_STANDALONE_RE.test(trimmed)) {
        emails.add(trimmed.toLowerCase());
      } else if (trimmed.includes(',') || trimmed.includes(';')) {
        for (const part of trimmed.split(/[,;]/).map(s => s.trim())) {
          if (EMAIL_STANDALONE_RE.test(part)) emails.add(part.toLowerCase());
        }
      }
    } else if (Array.isArray(v)) {
      v.forEach(scan);
    } else if (v && typeof v === 'object') {
      Object.values(v as Record<string, unknown>).forEach(scan);
    }
  };
  scan(args);
  return [...emails];
}

export function buildToolExecutor(ctx: ToolCallContext, mcp: MCPRegistry) {
  return async (agentName: string, call: ToolCall): Promise<string> => {
    await ctx.store.append('tool_call', { agent: agentName, tool: call.name, args: call.arguments });
    try {
      let result: string;
      const personalMcp = ctx.getPersonalMcp(agentName);
      const isMcpTool   = (personalMcp && personalMcp.isMCPTool(call.name)) || mcp.isMCPTool(call.name);
      if (isMcpTool) {
        const allowlist = ctx.emailAllowlistRef.store;
        if (allowlist) {
          const emails  = extractEmailsFromArgs(call.arguments ?? {});
          const blocked = emails.filter(e => !allowlist.isApproved(e));
          if (blocked.length > 0) {
            result = `Blocked: email address(es) not in the approved allowlist: ${blocked.join(', ')}. Use the request_email_approval tool to request approval, then retry once the human has approved it.`;
            await ctx.store.append('tool_result', { agent: agentName, tool: call.name, result });
            return result;
          }
        }
        // Personal MCP takes precedence over shared for the same tool name
        if (personalMcp && personalMcp.isMCPTool(call.name)) {
          result = await personalMcp.callTool(call.name, call.arguments);
        } else {
          result = await mcp.callTool(call.name, call.arguments);
        }
      } else {
        result = await executeToolCall(ctx, agentName, call);
      }
      await ctx.store.append('tool_result', { agent: agentName, tool: call.name, result });
      return result;
    } catch (err) {
      const error = (err as Error).message;
      await ctx.store.append('tool_error', { agent: agentName, tool: call.name, error });
      return `Error: ${error}`;
    }
  };
}

export async function executeToolCall(ctx: ToolCallContext, agentName: string, call: ToolCall): Promise<string> {
  switch (call.name) {
    case 'send_message': {
      const { to, message } = call.arguments as { to: string; message: string };
      const target = ctx.findByName(to);
      if (!target) return `No agent named "${to}" on this team.`;
      if (!message || !message.trim()) return `Message content is empty — call was rejected. Please include the full message content in the "message" argument and retry.`;
      const msg = buildMessage(agentName, to, 'direct', message);
      await ctx.store.append('direct_message', { from: agentName, to, content: message });
      ctx.deliverToAgent(to, msg);
      return `Message sent to ${to}.`;
    }

    case 'escalate_to_human': {
      const { message, urgency } = call.arguments as { message: string; urgency: 'low' | 'high' };
      ctx.findByName(agentName)?.markBlocked();
      await ctx.store.append('escalation', { from: agentName, urgency, message });
      ctx.onHumanEscalation?.(agentName, message, urgency);
      return `Escalation raised. Waiting for human response.`;
    }

    case 'report_task_complete': {
      const { summary } = call.arguments as { summary: string };
      ctx.findByName(agentName)?.markTaskComplete();
      for (const task of ctx.tasks.values()) {
        if (task.assignedTo === agentName && task.status === 'active') {
          task.status = 'complete';
          task.completedAt = new Date().toISOString();
          task.summary = summary;
          break;
        }
      }
      await ctx.store.append('task_complete', { agent: agentName, summary });
      for (const [meetingId, room] of ctx.activeMeetingRooms) {
        const meeting = ctx.meetings.get(meetingId);
        if (meeting?.facilitator === agentName) { room.close(); break; }
      }
      const blueHat = ctx.findBlueHat();
      if (blueHat && blueHat.name !== agentName) {
        const msg = buildMessage(agentName, blueHat.name, 'task_complete', summary);
        ctx.deliverToAgent(blueHat.name, msg);
      }
      return `Task marked complete.`;
    }

    case 'raise_hand': {
      for (const [meetingId, room] of ctx.activeMeetingRooms) {
        const meeting = ctx.meetings.get(meetingId);
        if (!meeting) continue;
        if (meeting.facilitator === agentName || meeting.participants.includes(agentName)) {
          room.raiseHand(agentName, true);
          break;
        }
      }
      return `Hand raised. You will be called on when it is your turn.`;
    }

    case 'disengage_conversation': {
      ctx.findByName(agentName)?.markTaskComplete();
      await ctx.store.append('agent_disengaged', { agent: agentName });
      const partner = ctx.lastSenderByAgent.get(agentName);
      if (partner && partner !== 'human') {
        const partnerAgent = ctx.findByName(partner);
        if (partnerAgent) {
          const note = buildMessage(
            agentName, partner, 'direct',
            `I've wrapped up my side of our conversation and stepped back. Feel free to disengage too if you have nothing more to add.`,
          );
          ctx.deliverToAgent(partner, note);
        }
      }
      return `You have disengaged from the conversation. You are now in a resting state and will not be drawn into further back-and-forth unless assigned a new task or contacted by the human.`;
    }

    case 'assign_task': {
      const { agent, task, context, projectName } = call.arguments as { agent: string; task: string; context?: string; projectName?: string };
      if (!ctx.findByName(agent)) return `No agent named "${agent}" on this team.`;
      const taskId = await ctx.createTask(agent, agentName, task, context, projectName);
      const storedTask = ctx.tasks.get(taskId)!;
      const folderNote = storedTask.projectFolder
        ? `\n\nProject folder: ${storedTask.projectFolder}\nUse read_file, write_file, and list_files to save and retrieve work there.`
        : '';
      const content = (context ? `${task}\n\nContext: ${context}` : task) + folderNote;
      const msg = buildMessage(agentName, agent, 'task', content, { taskId });
      await ctx.store.append('task_assigned', { taskId, from: agentName, to: agent, task, context, projectName: storedTask.projectName });
      ctx.deliverToAgent(agent, msg);
      return `Task assigned to ${agent}. Project folder: ${storedTask.projectFolder ?? 'none'}`;
    }

    case 'request_meeting': {
      const { participants, topic, agenda } = call.arguments as { participants: string[]; topic: string; agenda?: string };
      const invalid = participants.filter((p) => p !== 'human' && !ctx.hasAgentWithName(p));
      if (invalid.length > 0) return `Unknown participants: ${invalid.join(', ')}`;
      await ctx.startMeeting(agentName, participants, topic, agenda);
      return `Meeting "${topic}" started.`;
    }

    case 'schedule_meeting': {
      const { type, participants, topic, agenda, scheduledFor } = call.arguments as {
        type: MeetingType; participants: string[]; topic: string; agenda?: string; scheduledFor: string;
      };
      if (!ctx.scheduledMeetingStore) return 'Meeting scheduling is not available in this project.';
      const invalid = participants.filter((p) => p !== 'human' && !ctx.hasAgentWithName(p));
      if (invalid.length > 0) return `Unknown participants: ${invalid.join(', ')}`;
      const when = new Date(scheduledFor);
      if (isNaN(when.getTime())) return `Invalid scheduledFor date: "${scheduledFor}". Use ISO-8601 format, e.g. "2026-04-01T09:00:00".`;
      if (when <= new Date()) return `scheduledFor must be in the future.`;
      const scheduled = await ctx.createScheduledMeeting({
        type, topic, agenda,
        facilitator: agentName,
        participants,
        scheduledFor: when.toISOString(),
        createdBy: agentName,
      });
      return `Meeting "${topic}" scheduled for ${when.toLocaleString()} (id: ${scheduled.id}).`;
    }

    case 'read_file': {
      const { path: filePath } = call.arguments as { path: string };
      const resolved = ctx.resolveAgentPath(agentName, filePath);
      try {
        return await readFile(resolved, 'utf-8');
      } catch (err) {
        return `Error reading file: ${(err as Error).message}`;
      }
    }

    case 'write_file': {
      const { path: filePath, content } = call.arguments as { path: string; content: string };
      const resolved = ctx.resolveAgentPath(agentName, filePath);
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
      const resolved = ctx.resolveAgentPath(agentName, directory ?? '.');
      try {
        const entries = await readdir(resolved, { withFileTypes: true });
        const lines = entries.map((e) => `${e.isDirectory() ? '[dir] ' : '      '}${e.name}`);
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
          headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey },
        });
        if (!resp.ok) return `Search API error: ${resp.status} ${resp.statusText}`;
        const data = await resp.json() as { web?: { results?: Array<{ title: string; url: string; description?: string }> } };
        const results = data.web?.results ?? [];
        if (results.length === 0) return 'No results found.';
        return results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.description ?? ''}`).join('\n\n');
      } catch (err) {
        return `Search error: ${(err as Error).message}`;
      }
    }

    case 'get_current_datetime': {
      const now = new Date();
      return `Current date and time: ${now.toISOString()} (local: ${now.toLocaleString()})`;
    }

    case 'fetch_url': {
      const { url, filePath: rawPath } = call.arguments as { url: string; filePath?: string };
      if (!url?.trim()) return 'url argument is required.';
      const projectDir = ctx.projectDir ?? '.';
      const outputsDir = path.join(projectDir, 'outputs');

      // Derive filename from URL if not provided
      const derivedName = rawPath?.trim() || (() => {
        try {
          const u = new URL(url);
          const base = path.basename(u.pathname) || u.hostname;
          return base.includes('.') ? base : `${base}.html`;
        } catch { return 'fetched-content.html'; }
      })();
      const dest = path.isAbsolute(derivedName)
        ? derivedName
        : path.join(outputsDir, derivedName);

      try {
        const resp = await fetch(url);
        if (!resp.ok) return `Fetch failed: ${resp.status} ${resp.statusText}`;
        const body = await resp.text();
        await mkdir(path.dirname(dest), { recursive: true });
        await writeFile(dest, body, 'utf-8');
        return `Saved ${body.length} characters to ${dest}`;
      } catch (err) {
        return `Fetch error: ${(err as Error).message}`;
      }
    }

    case 'request_email_approval': {
      const { email, reason } = call.arguments as { email: string; reason?: string };
      if (!email?.trim()) return 'email argument is required.';
      const store = ctx.emailAllowlistRef.store;
      if (!store) return 'Email allowlist is not configured in this project.';
      const existing = store.get(email.trim());
      if (existing?.status === 'approved') return `${email} is already approved — you can proceed.`;
      if (existing?.status === 'pending')  return `Approval for ${email} is already pending. Please wait for the human to review it in the Allowlist panel.`;
      await store.add({
        email:       email.trim().toLowerCase(),
        status:      'pending',
        requestedBy: agentName,
        reason,
        requestedAt: new Date().toISOString(),
      });
      await ctx.store.append('email_approval_requested', { from: agentName, email: email.trim().toLowerCase(), reason });
      return `Approval request submitted for ${email}. Please wait — the human will review it in the Allowlist panel before you can use it.`;
    }

    case 'check_email_permissions': {
      const store = ctx.emailAllowlistRef.store;
      if (!store) return 'Email allowlist is not configured in this project.';
      const mine = store.list().filter(e => e.requestedBy === agentName);
      if (mine.length === 0) return 'You have no email permission requests on record.';

      // Only surface entries the agent hasn't been told about yet: pending ones,
      // and approved/rejected ones with no notifiedAt stamp.
      const pending   = mine.filter(e => e.status === 'pending');
      const newlyDone = mine.filter(e => e.status !== 'pending' && !e.notifiedAt);

      if (pending.length === 0 && newlyDone.length === 0) {
        return 'No new updates to your email permission requests since your last check.';
      }

      const lines: string[] = [];
      for (const e of newlyDone) {
        if (e.status === 'approved') lines.push(`APPROVED: ${e.email} — you may now send emails to this address`);
        if (e.status === 'rejected') lines.push(`REJECTED: ${e.email} — do not contact this address`);
      }
      for (const e of pending) {
        lines.push(`PENDING: ${e.email} — still awaiting human review`);
      }

      // Mark newly resolved entries so they won't be reported again
      if (newlyDone.length > 0) {
        await store.markNotified(newlyDone.map(e => e.email));
      }

      return `Email permission updates:\n${lines.join('\n')}`;
    }

    case 'schedule_action': {
      const { label, description, intervalMinutes, delayMinutes } = call.arguments as {
        label: string; description: string; intervalMinutes?: number; delayMinutes?: number;
      };
      const agenda = ctx.agendaStore.store;
      if (!agenda) return 'Agenda scheduling is not available in this project.';
      const intervalSeconds = (intervalMinutes && intervalMinutes > 0) ? Math.round(intervalMinutes * 60) : null;
      const delaySeconds    = delayMinutes != null ? Math.round(delayMinutes * 60) : undefined;
      const entry = await agenda.add({ agentName, label, description, intervalSeconds, delaySeconds });
      const nextStr   = new Date(entry.nextRunAt).toLocaleString();
      const repeatStr = intervalSeconds ? ` Repeats every ${intervalMinutes} minute(s).` : ' One-off.';
      return `Action "${label}" scheduled (id: ${entry.id}). First run: ${nextStr}.${repeatStr}`;
    }

    case 'list_my_actions': {
      const agenda = ctx.agendaStore.store;
      if (!agenda) return 'Agenda scheduling is not available in this project.';
      const actions = agenda.list(agentName).filter(e => e.enabled);
      if (actions.length === 0) return 'You have no scheduled actions.';
      return actions.map(e => {
        const next   = new Date(e.nextRunAt).toLocaleString();
        const repeat = e.intervalSeconds ? `every ${Math.round(e.intervalSeconds / 60)} min` : 'once';
        return `- [${e.id}] "${e.label}" (${repeat}) — next: ${next}`;
      }).join('\n');
    }

    case 'cancel_action': {
      const { id } = call.arguments as { id: string };
      const agenda = ctx.agendaStore.store;
      if (!agenda) return 'Agenda scheduling is not available in this project.';
      const entry = agenda.get(id);
      if (!entry) return `No action found with id "${id}".`;
      if (entry.agentName !== agentName) return `Action "${id}" does not belong to you.`;
      await agenda.remove(id);
      return `Action "${entry.label}" cancelled.`;
    }

    default:
      return `Unknown tool: ${call.name}`;
  }
}
