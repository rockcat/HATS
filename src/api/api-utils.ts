import * as path from 'path';
import { IncomingMessage } from 'http';
import { readdir, stat } from 'fs/promises';
import { Board } from '../mcp/kanban/types.js';
import { HumanRequest } from '../orchestrator/types.js';
import { TeamOrchestrator } from '../orchestrator/orchestrator.js';
import { AgentStatus } from './project-manager.js';

export function stateLabel(state: string): string {
  switch (state) {
    case 'idle':             return 'Ready';
    case 'working':          return 'Working…';
    case 'waiting_for_help': return 'Waiting for help…';
    case 'in_discussion':    return 'In discussion';
    default:                 return state;
  }
}

type Priority = 'low' | 'medium' | 'high' | 'critical';
type Column   = 'backlog' | 'ready' | 'in_progress' | 'blocked' | 'completed';

export function buildBoardSummary(board: Board, includeBacklog: boolean) {
  const columns: Column[] = includeBacklog
    ? ['backlog', 'ready', 'in_progress', 'blocked', 'completed']
    : ['ready', 'in_progress', 'blocked', 'completed'];

  const pri: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const result: Record<string, { count: number; tickets: unknown[] }> = {};

  for (const col of columns) {
    const tickets = Object.values(board.tickets)
      .filter((t) => t.column === col)
      .sort((a, b) =>
        (pri[a.priority as Priority] - pri[b.priority as Priority]) ||
        a.createdAt.localeCompare(b.createdAt),
      )
      .map((t) => ({ id: t.id, title: t.title, priority: t.priority, assignee: t.assignee, tags: t.tags, updatedAt: t.updatedAt }));
    result[col] = { count: tickets.length, tickets };
  }
  return result;
}

export async function listFilesRecursive(
  dir: string,
  projectDir: string,
  relBase = '',
): Promise<Array<{ name: string; relativePath: string; size: number; modified: string; isDir: boolean }>> {
  const results: Array<{ name: string; relativePath: string; size: number; modified: string; isDir: boolean }> = [];
  let entries: import('fs').Dirent<string>[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push({ name: entry.name, relativePath: rel, size: 0, modified: '', isDir: true });
      const children = await listFilesRecursive(path.join(dir, entry.name), projectDir, rel);
      results.push(...children);
    } else {
      try {
        const s = await stat(path.join(dir, entry.name));
        results.push({ name: entry.name, relativePath: rel, size: s.size, modified: s.mtime.toISOString(), isDir: false });
      } catch { /* skip */ }
    }
  }
  return results;
}

export function buildAgentStatuses(
  orchestrator: TeamOrchestrator,
  agentActivity: Map<string, { activity: string; talkingTo?: string }>,
): AgentStatus[] {
  return orchestrator.listAgents().map((a) => {
    const extra = agentActivity.get(a.name);
    return {
      name: a.name, hatType: a.hatType, state: a.state,
      activity: extra?.activity ?? stateLabel(a.state),
      talkingTo: extra?.talkingTo,
      model: a.config.model, provider: a.config.provider.name,
      specialisation: a.config.identity.specialisation,
      visualDescription: a.config.identity.visualDescription,
      backstory: a.config.identity.backstory,
      avatar: a.config.identity.avatar,
      background: (a.config.identity as { background?: string }).background,
      voice: a.config.identity.voice,
      speakerName: a.config.identity.speakerName,
      enabledMcpServers: a.config.enabledMcpServers,
    };
  });
}

export function buildRequestsList(humanRequests: Map<string, HumanRequest>): HumanRequest[] {
  const all      = Array.from(humanRequests.values());
  const pending  = all.filter(r => r.status === 'pending')
    .sort((a, b) => (b.urgency === 'high' ? 1 : 0) - (a.urgency === 'high' ? 1 : 0) || a.createdAt.localeCompare(b.createdAt));
  const answered = all.filter(r => r.status === 'answered')
    .sort((a, b) => (b.answeredAt ?? '').localeCompare(a.answeredAt ?? ''));
  return [...pending, ...answered];
}

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export function readBodyBuffer(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
