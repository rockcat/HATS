import * as path from 'path';
import { mkdir } from 'fs/promises';
import { TeamOrchestrator } from '../orchestrator/orchestrator.js';
import { StoredEvent } from '../store/event-store.js';
import { log } from '../util/logger.js';
import { KanbanManager } from './kanban-manager.js';
import { ProjectManager, AgentStatus } from './project-manager.js';
import { ProjectLoader } from './api-server.js';

export interface ProjectSwitchContext {
  projectLoader: ProjectLoader;
  projectsRoot: string;
  projectDir: string | null;
  orchestrator: TeamOrchestrator;
  kanbanManager: KanbanManager;
  projectManager: ProjectManager;
  enabledMCPIds: Set<string>;
  agentActivity: Map<string, { activity: string; talkingTo?: string }>;
  agentFeeds: Map<string, StoredEvent[]>;
  agentTicketMap: Map<string, string>;
  talkingTimers: Map<string, ReturnType<typeof setTimeout>>;
  unsubscribeEvents: (() => void) | null;
  onStateChange(update: {
    orchestrator?: TeamOrchestrator;
    projectDir?: string;
    projectId?: string;
    mcpEnabledPath?: string;
    meetingsPath?: string;
    unsubscribeEvents?: (() => void) | null;
  }): void;
  subscribeToOrchestrator(o: TeamOrchestrator): () => void;
  loadMCPEnabled(): Promise<void>;
  buildAgentStatuses(): AgentStatus[];
  sseBroadcast(data: object): void;
  projectSwitchCallback: ((o: TeamOrchestrator) => void) | null;
}

export async function executeProjectSwitch(newId: string, ctx: ProjectSwitchContext): Promise<void> {
  const newProjectDir   = path.join(ctx.projectsRoot, newId);
  const newKanbanFile   = path.join(newProjectDir, 'kanban-board.json');
  const newStateFile    = path.join(newProjectDir, 'team-state.json');
  const newMcpFile      = path.join(newProjectDir, 'mcp-enabled.json');
  const newMeetingsFile = path.join(newProjectDir, 'meetings.json');

  await mkdir(newProjectDir, { recursive: true });

  if (ctx.projectDir) {
    await ctx.orchestrator.saveState(path.join(ctx.projectDir, 'team-state.json'));
    log.info(`[API] Saved state for project "${ctx.projectDir}"`);
  }

  ctx.unsubscribeEvents?.();
  ctx.kanbanManager.closeWatcher();
  ctx.agentActivity.clear();
  ctx.agentFeeds.clear();
  ctx.agentTicketMap.clear();
  ctx.talkingTimers.forEach(t => clearTimeout(t));
  ctx.talkingTimers.clear();
  ctx.enabledMCPIds.clear();

  if (ctx.orchestrator.hasMCPServer('filesystem')) {
    await ctx.orchestrator.removeMCPServer('filesystem').catch(() => {});
  }

  log.info(`[API] Switching to project "${newId}" (${newProjectDir})`);
  const newOrchestrator = await ctx.projectLoader(newProjectDir, newKanbanFile, newStateFile);

  ctx.onStateChange({ orchestrator: newOrchestrator, mcpEnabledPath: newMcpFile, meetingsPath: newMeetingsFile, projectId: newId, projectDir: newProjectDir });
  ctx.kanbanManager.kanbanPath = newKanbanFile;
  await newOrchestrator.initMeetingStore(newMeetingsFile).catch(() => {});

  await ctx.projectManager.ensureProjectFolders(newProjectDir);
  newOrchestrator.setProjectDir(newProjectDir);
  const newMeta = await ctx.projectManager.readProjectMeta();
  if (newMeta['goal'])      newOrchestrator.setProjectGoal(newMeta['goal']);
  if (newMeta['humanName']) newOrchestrator.setHumanName(newMeta['humanName']);

  await ctx.projectManager.initTelemetryStore(path.join(newProjectDir, 'telemetry.jsonl'));
  ctx.onStateChange({ unsubscribeEvents: ctx.subscribeToOrchestrator(newOrchestrator) });

  ctx.kanbanManager.watchKanban(newKanbanFile);
  await ctx.loadMCPEnabled().catch(() => {});
  await ctx.projectManager.assignDefaultVisuals().catch(() => {});

  const agents        = ctx.buildAgentStatuses();
  const tickets       = await ctx.kanbanManager.readTickets().catch(() => []);
  const broadcastMeta = await ctx.projectManager.readProjectMeta();
  const project       = { id: newId, dir: newProjectDir, goal: broadcastMeta['goal'] ?? '', humanName: broadcastMeta['humanName'] ?? 'Human' };
  ctx.sseBroadcast({ type: 'init', agents, tickets, project } as never);
  ctx.sseBroadcast({ type: 'telemetry_update', summary: ctx.projectManager.telemetry?.getSummary() ?? null });

  ctx.kanbanManager.dispatchUnstartedTickets().catch(() => {});
  log.info(`[API] Project switched to "${newId}"`);
  ctx.projectSwitchCallback?.(newOrchestrator);
}
