import { TeamOrchestrator } from '../orchestrator/orchestrator.js';
import { Task, Meeting } from '../orchestrator/types.js';

export interface CLIContext {
  orchestrator: TeamOrchestrator;
  agentTicketMap: Map<string, string>;
  updateKanbanColumn(ticketId: string, column: string): Promise<void>;
  dispatchUnstartedTickets(): Promise<void>;
  resolveAgentName(input: string): string;
}

export async function handleCLICommand(line: string, ctx: CLIContext): Promise<string> {
  if (!line) return '';

  if (line.startsWith('@')) {
    const spaceIdx = line.indexOf(' ');
    if (spaceIdx === -1) return 'Usage: @AgentName message';
    const name    = ctx.resolveAgentName(line.slice(1, spaceIdx));
    const message = line.slice(spaceIdx + 1);
    await ctx.orchestrator.humanMessage(name, message);
    const ticketId = ctx.agentTicketMap.get(name.toLowerCase());
    if (ticketId) ctx.updateKanbanColumn(ticketId, 'in_progress').catch(() => {});
    return `→ Sent to ${name}`;
  }

  if (line.startsWith('task ')) {
    const rest      = line.slice(5);
    const colonIdx  = rest.indexOf(':');
    if (colonIdx === -1) return 'Usage: task AgentName [project-name]: description';
    const beforeColon  = rest.slice(0, colonIdx).trim();
    const task         = rest.slice(colonIdx + 1).trim();
    const bracketMatch = beforeColon.match(/^(\S+)\s+\[([^\]]+)\]$/);
    const name         = ctx.resolveAgentName(bracketMatch ? bracketMatch[1] : beforeColon);
    const projectName  = bracketMatch ? bracketMatch[2] : undefined;
    await ctx.orchestrator.humanAssignTask(name, task, undefined, projectName);
    const stored = ctx.orchestrator.listTasks().find(t => t.assignedTo === name && t.description === task);
    return `Task assigned to ${name}. Project folder: ${stored?.projectFolder ?? '?'}`;
  }

  if (line.startsWith('reply ')) {
    const rest     = line.slice(6);
    const colonIdx = rest.indexOf(':');
    if (colonIdx === -1) return 'Usage: reply AgentName: message';
    const name    = ctx.resolveAgentName(rest.slice(0, colonIdx).trim());
    const message = rest.slice(colonIdx + 1).trim();
    await ctx.orchestrator.humanReply(name, message);
    const ticketId = ctx.agentTicketMap.get(name.toLowerCase());
    if (ticketId) ctx.updateKanbanColumn(ticketId, 'in_progress').catch(() => {});
    return `→ Sent to ${name}`;
  }

  if (line === 'resume') {
    const active = ctx.orchestrator.listTasks().filter(t => t.status === 'active');
    for (const task of active) {
      const name = ctx.resolveAgentName(task.assignedTo);
      await ctx.orchestrator.humanMessage(name, `You have an active task to continue: ${task.description}`);
    }
    await ctx.dispatchUnstartedTickets();
    return active.length > 0
      ? `Resumed ${active.length} active task(s) and re-dispatched in-progress kanban tickets.`
      : 'Re-dispatched in-progress kanban tickets.';
  }

  if (line === 'status') {
    const agents = ctx.orchestrator.listAgents();
    if (agents.length === 0) return 'No agents.';
    return agents.map(a => `  ${a.name} (${a.hatType} hat) — ${a.state}`).join('\n');
  }

  if (line === 'tasks') {
    const tasks = ctx.orchestrator.listTasks() as Task[];
    if (tasks.length === 0) return 'No tasks.';
    return tasks.map(t => {
      const done = t.status === 'complete' ? ` ✓ ${(t.summary ?? '').slice(0, 40)}` : '';
      return `  [${t.status.padEnd(8)}] ${t.assignedTo}: ${t.description.slice(0, 50)}${done}`;
    }).join('\n');
  }

  if (line === 'meetings') {
    const meetings = ctx.orchestrator.listMeetings() as Meeting[];
    if (meetings.length === 0) return 'No meetings.';
    return meetings.map(m => `  [${m.status}] "${m.topic}" — ${m.turns.length} turns`).join('\n');
  }

  if (line === 'help') {
    return [
      'Commands:',
      '  message                        — broadcast to ALL agents (interrupts current work)',
      '  @AgentName message             — DM a specific agent',
      '  task AgentName: text           — assign a task',
      '  task AgentName [name]: text    — assign with project name',
      '  reply AgentName: text          — reply to escalation',
      '  status                         — show agent states',
      '  tasks                          — list tasks',
      '  meetings                       — list meetings',
      '  resume                         — re-deliver active tasks',
      '  help                           — this help',
    ].join('\n');
  }

  const agents = ctx.orchestrator.listAgents();
  if (agents.length === 0) return 'No agents available.';
  await ctx.orchestrator.broadcastHumanMessage(line);
  return `→ Broadcast to all agents (${agents.map(a => a.name).join(', ')})`;
}
