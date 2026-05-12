import { IncomingMessage, ServerResponse } from 'http';
import { readFile, writeFile, rename } from 'fs/promises';
import * as fs from 'fs';
import * as path from 'path';
import { TeamOrchestrator } from '../orchestrator/orchestrator.js';
import { Task } from '../orchestrator/types.js';
import { Board } from '../mcp/kanban/types.js';
import { log } from '../util/logger.js';
import { buildBoardSummary } from './api-utils.js';

export interface KanbanManagerDeps {
  getOrchestrator(): TeamOrchestrator;
  agentTicketMap: Map<string, string>;
  agentActivity: Map<string, { activity: string; talkingTo?: string }>;
  resolveAgentName(input: string): string;
  sseBroadcast(data: object): void;
  json(res: ServerResponse, status: number, body: unknown): void;
  readBody(req: IncomingMessage): Promise<string>;
}

export class KanbanManager {
  kanbanPath: string | null;
  private deps: KanbanManagerDeps;
  private kanbanWatcher: fs.FSWatcher | null = null;
  private kanbanDebounce: ReturnType<typeof setTimeout> | null = null;

  constructor(kanbanPath: string | null, deps: KanbanManagerDeps) {
    this.kanbanPath = kanbanPath;
    this.deps = deps;
  }

  async readKanban(): Promise<Board> {
    const raw = await readFile(this.kanbanPath!, 'utf-8');
    return JSON.parse(raw) as Board;
  }

  async writeKanban(board: Board): Promise<void> {
    const tmp = this.kanbanPath! + '.tmp';
    await writeFile(tmp, JSON.stringify(board, null, 2), 'utf-8');
    await rename(tmp, this.kanbanPath!);
  }

  async readTickets(): Promise<Board['tickets'][string][]> {
    if (!this.kanbanPath) return [];
    const board = await this.readKanban();
    return Object.values(board.tickets);
  }

  watchKanban(filePath: string): void {
    try {
      this.kanbanWatcher = fs.watch(filePath, () => {
        if (this.kanbanDebounce) clearTimeout(this.kanbanDebounce);
        this.kanbanDebounce = setTimeout(async () => {
          try {
            const tickets = await this.readTickets();
            this.deps.sseBroadcast({ type: 'kanban_update', tickets });
          } catch { /* file may be mid-write */ }
        }, 150);
      });
    } catch {
      // File may not exist yet
    }
  }

  closeWatcher(): void {
    this.kanbanWatcher?.close();
    this.kanbanWatcher = null;
  }

  async updateKanbanColumn(ticketId: string, column: string): Promise<void> {
    if (!this.kanbanPath) return;
    const board  = await this.readKanban();
    const ticket = board.tickets[ticketId];
    if (!ticket || ticket.column === column) return;
    ticket.column    = column as never;
    ticket.updatedAt = new Date().toISOString();
    await this.writeKanban(board);
    log.info(`[API] Ticket ${ticketId} → ${column}`);
    if (column === 'completed') {
      this.unblockDependents(ticketId).catch(() => {});
    }
  }

  async addTicketComment(ticketId: string, author: string, text: string): Promise<void> {
    if (!this.kanbanPath) return;
    const board  = await this.readKanban();
    const ticket = board.tickets[ticketId];
    if (!ticket) return;
    ticket.comments.push({ id: `c${Date.now()}`, author, text, ts: new Date().toISOString() });
    ticket.updatedAt = new Date().toISOString();
    await this.writeKanban(board);
  }

  async createEscalationTicket(from: string, message: string, urgency: string): Promise<void> {
    if (!this.kanbanPath) return;
    const board = await this.readKanban();
    const id    = `TKT-${String(board.nextSeq).padStart(3, '0')}`;
    board.nextSeq++;
    const now      = new Date().toISOString();
    const shortMsg = message.length > 80 ? `${message.slice(0, 77)}…` : message;
    const priority = urgency === 'high' || urgency === 'critical' ? 'high' : 'medium';
    board.tickets[id] = {
      id,
      title:       `Escalation from ${from}: ${shortMsg}`,
      description: message,
      priority:    priority as never,
      column:      'ready' as never,
      creator:     from,
      assignee:    'human',
      tags:        ['escalation'],
      comments:    [],
      createdAt:   now,
      updatedAt:   now,
    };
    await this.writeKanban(board);
    log.info(`[API] Created escalation ticket ${id} for human from ${from}`);
  }

  async unblockDependents(completedId: string): Promise<void> {
    if (!this.kanbanPath) return;
    const board = await this.readKanban();
    const unblocked: Array<typeof board.tickets[string]> = [];
    let changed = false;
    for (const ticket of Object.values(board.tickets)) {
      if (!(ticket.blockedBy ?? []).includes(completedId)) continue;
      ticket.blockedBy = ticket.blockedBy!.filter(b => b !== completedId);
      ticket.updatedAt = new Date().toISOString();
      changed = true;
      if (ticket.blockedBy.length === 0 && ticket.column === 'blocked') {
        ticket.column = 'ready';
        unblocked.push(ticket);
        log.info(`[API] ${ticket.id} unblocked by completion of ${completedId} → ready`);
      }
    }
    if (changed) await this.writeKanban(board);

    const orch = this.deps.getOrchestrator();
    for (const ticket of unblocked) {
      if (!ticket.assignee) continue;
      const agentName = this.deps.resolveAgentName(ticket.assignee);
      const isKnown = orch.listAgents().some(a => a.name.toLowerCase() === agentName.toLowerCase());
      if (!isKnown) continue;
      orch.humanMessage(agentName,
        `Good news! ${completedId} has been completed, which unblocks your ticket ${ticket.id}: "${ticket.title}". It's now ready to start.`,
      ).catch(() => {});
    }
  }

  async nudgeStaleTickets(): Promise<void> {
    if (!this.kanbanPath) return;
    const board   = await this.readKanban();
    const STALE   = 30 * 60 * 1000;
    const now     = Date.now();
    const orch    = this.deps.getOrchestrator();
    for (const ticket of Object.values(board.tickets)) {
      if (ticket.column !== 'in_progress' && ticket.column !== 'blocked') continue;
      if (!ticket.assignee) continue;
      const age = now - new Date(ticket.updatedAt).getTime();
      if (age < STALE) continue;
      const agentName = this.deps.resolveAgentName(ticket.assignee);
      const isKnown   = orch.listAgents().some(a => a.name.toLowerCase() === agentName.toLowerCase());
      if (!isKnown) continue;
      const activity = this.deps.agentActivity.get(agentName)?.activity ?? '';
      if (activity.toLowerCase().includes('working')) continue;
      const blockers = (ticket.blockedBy ?? []).join(', ');
      const msg = ticket.column === 'blocked' && blockers
        ? `Checking in on ${ticket.id}: "${ticket.title}". It's blocked on [${blockers}]. Are those blockers resolved? If so, update the ticket status.`
        : `Checking in on ${ticket.id}: "${ticket.title}". It's been in progress for a while. Any updates? Please move it to completed if done, or add a comment on current status.`;
      orch.humanMessage(agentName, msg).catch(() => {});
      log.info(`[API] Nudged ${agentName} about stale ticket ${ticket.id}`);
    }
  }

  async dispatchUnstartedTickets(): Promise<void> {
    if (!this.kanbanPath) return;
    const board = await this.readKanban();
    for (const ticket of Object.values(board.tickets)) {
      if (ticket.column === 'in_progress' && ticket.assignee) {
        this.deps.agentTicketMap.set(ticket.assignee.toLowerCase(), ticket.id);
        await this.dispatchTicket(ticket);
      }
    }
  }

  async dispatchTicket(ticket: { id: string; title: string; description: string; assignee?: string; priority?: string; tags?: string[] }): Promise<void> {
    if (!ticket.assignee) return;
    const orch      = this.deps.getOrchestrator();
    const agentName = this.deps.resolveAgentName(ticket.assignee);
    const isKnown   = orch.listAgents().some(a => a.name.toLowerCase() === agentName.toLowerCase());
    if (!isKnown) return;

    const alreadyActive = (orch.listTasks() as Task[]).some(
      t => t.status === 'active' && t.assignedTo.toLowerCase() === agentName.toLowerCase()
        && t.description.includes(ticket.id),
    );
    if (alreadyActive) return;

    const projectName = ticket.id;
    const description = `Work on ticket ${ticket.id}: ${ticket.title}${ticket.description ? `\n\n${ticket.description}` : ''}`;
    await orch.humanAssignTask(agentName, description, undefined, projectName);
    this.deps.agentTicketMap.set(agentName.toLowerCase(), ticket.id);

    const stored = (orch.listTasks() as Task[]).find(
      t => t.assignedTo.toLowerCase() === agentName.toLowerCase() && t.description.includes(ticket.id),
    );
    if (stored?.projectFolder && this.kanbanPath) {
      try {
        const board = await this.readKanban();
        const kt = board.tickets[ticket.id];
        if (kt) {
          kt.projectName   = stored.projectName ?? projectName;
          kt.projectFolder = stored.projectFolder;
          kt.updatedAt     = new Date().toISOString();
          await this.writeKanban(board);
        }
      } catch { /* non-fatal */ }

      try {
        const readme = [
          `# ${ticket.id}: ${ticket.title}`,
          '',
          `**Priority:** ${ticket.priority ?? 'medium'}`,
          ticket.assignee ? `**Assignee:** ${ticket.assignee}` : '',
          (ticket.tags?.length ?? 0) > 0 ? `**Tags:** ${ticket.tags!.join(', ')}` : '',
          '',
          '## Description',
          '',
          ticket.description || '(none)',
          '',
          '## Instructions',
          '',
          'Save all outputs, artefacts, and notes in this folder.',
          'Use `write_file`, `read_file`, and `list_files` to manage files here.',
        ].filter(l => l !== undefined).join('\n');
        await writeFile(path.join(stored.projectFolder, 'README.md'), readme, 'utf-8');
      } catch { /* non-fatal */ }
    }
    log.info(`[API] Dispatched ${ticket.id} → ${agentName} (project: ${stored?.projectFolder ?? '?'})`);
  }

  async handleRoutes(pathname: string, method: string, url: URL, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const { json, readBody } = this.deps;

    if (pathname === '/api/kanban') {
      if (!this.kanbanPath) { json(res, 404, { error: 'Kanban not configured' }); return true; }
      const includeBacklog = url.searchParams.get('includeBacklog') === 'true';
      const board = await this.readKanban();
      json(res, 200, buildBoardSummary(board, includeBacklog));
      return true;
    }

    if (pathname === '/api/kanban/tickets' && method === 'GET') {
      if (!this.kanbanPath) { json(res, 404, { error: 'Kanban not configured' }); return true; }
      const tickets = await this.readTickets();
      json(res, 200, { tickets });
      return true;
    }

    if (pathname === '/api/kanban/tickets' && method === 'POST') {
      if (!this.kanbanPath) { json(res, 404, { error: 'Kanban not configured' }); return true; }
      const body   = await readBody(req);
      const fields = JSON.parse(body) as {
        title: string; description?: string; priority?: string;
        column?: string; assignee?: string; tags?: string[]; blockedBy?: string[];
      };
      if (!fields.title?.trim()) { json(res, 400, { error: 'Title is required' }); return true; }
      const board = await this.readKanban();
      const id    = `TKT-${String(board.nextSeq).padStart(3, '0')}`;
      board.nextSeq++;
      const now   = new Date().toISOString();
      board.tickets[id] = {
        id,
        title:       fields.title.trim(),
        description: fields.description ?? '',
        priority:    (fields.priority ?? 'medium') as never,
        column:      (fields.column ?? 'backlog') as never,
        creator:     'human',
        assignee:    fields.assignee || undefined,
        tags:        fields.tags ?? [],
        blockedBy:   fields.blockedBy?.length ? fields.blockedBy : undefined,
        comments:    [],
        createdAt:   now,
        updatedAt:   now,
      };
      await this.writeKanban(board);
      json(res, 201, board.tickets[id]);
      if (board.tickets[id].column === 'in_progress' && board.tickets[id].assignee) {
        this.dispatchTicket(board.tickets[id]).catch(() => {});
      }
      return true;
    }

    if (pathname === '/api/kanban/tickets') {
      if (!this.kanbanPath) { json(res, 404, { error: 'Kanban not configured' }); return true; }
      const board    = await this.readKanban();
      const column   = url.searchParams.get('column') ?? undefined;
      const assignee = url.searchParams.get('assignee') ?? undefined;
      let tickets    = Object.values(board.tickets);
      if (column)   tickets = tickets.filter((t) => t.column === column);
      if (assignee) tickets = tickets.filter((t) => t.assignee === assignee);
      json(res, 200, tickets);
      return true;
    }

    if (pathname.match(/^\/api\/kanban\/tickets\/[^/]+\/comments$/) && method === 'POST') {
      if (!this.kanbanPath) { json(res, 404, { error: 'Kanban not configured' }); return true; }
      const id     = pathname.replace('/api/kanban/tickets/', '').replace('/comments', '');
      const body   = await readBody(req);
      const { author, text } = JSON.parse(body) as { author: string; text: string };
      if (!text?.trim()) { json(res, 400, { error: 'Text is required' }); return true; }
      const board  = await this.readKanban();
      const ticket = board.tickets[id];
      if (!ticket) { json(res, 404, { error: `Ticket "${id}" not found` }); return true; }
      const comment = { id: `c${Date.now()}`, author: author?.trim() || 'human', text: text.trim(), ts: new Date().toISOString() };
      ticket.comments.push(comment);
      ticket.updatedAt = comment.ts;
      await this.writeKanban(board);
      json(res, 201, comment);
      return true;
    }

    if (pathname.startsWith('/api/kanban/tickets/') && method === 'PATCH') {
      if (!this.kanbanPath) { json(res, 404, { error: 'Kanban not configured' }); return true; }
      const id     = pathname.replace('/api/kanban/tickets/', '');
      const body   = await readBody(req);
      const fields = JSON.parse(body) as Partial<{
        title: string; description: string; priority: string;
        column: string; assignee: string | null; tags: string[]; blockedBy: string[];
      }>;
      const board  = await this.readKanban();
      const ticket = board.tickets[id];
      if (!ticket) { json(res, 404, { error: `Ticket "${id}" not found` }); return true; }
      const prevColumn   = ticket.column;
      const prevAssignee = ticket.assignee;
      if (fields.title       !== undefined) ticket.title       = fields.title;
      if (fields.description !== undefined) ticket.description = fields.description;
      if (fields.priority    !== undefined) ticket.priority    = fields.priority as never;
      if (fields.column      !== undefined) ticket.column      = fields.column   as never;
      if (fields.assignee    !== undefined) ticket.assignee    = fields.assignee ?? undefined;
      if (fields.tags        !== undefined) ticket.tags        = fields.tags;
      if (fields.blockedBy   !== undefined) ticket.blockedBy   = fields.blockedBy;
      ticket.updatedAt = new Date().toISOString();
      await this.writeKanban(board);
      json(res, 200, ticket);
      const columnChanged   = fields.column   !== undefined && prevColumn   !== ticket.column;
      const assigneeChanged = fields.assignee !== undefined && prevAssignee !== ticket.assignee;
      if (columnChanged && ticket.column === 'completed') {
        this.unblockDependents(id).catch(() => {});
      }
      if (ticket.column === 'in_progress' && ticket.assignee && (columnChanged || assigneeChanged)) {
        this.dispatchTicket(ticket).catch(() => {});
      }
      return true;
    }

    if (pathname.startsWith('/api/kanban/tickets/')) {
      if (!this.kanbanPath) { json(res, 404, { error: 'Kanban not configured' }); return true; }
      const id     = pathname.replace('/api/kanban/tickets/', '');
      const board  = await this.readKanban();
      const ticket = board.tickets[id];
      if (!ticket) { json(res, 404, { error: `Ticket "${id}" not found` }); return true; }
      json(res, 200, ticket);
      return true;
    }

    return false;
  }
}
