import * as path from 'path';
import { mkdir } from 'fs/promises';
import { TeamOrchestrator } from '../orchestrator/orchestrator.js';
import { StoredEvent } from '../store/event-store.js';
import { log } from '../util/logger.js';
import { KanbanManager } from './kanban-manager.js';
import { HumanRequestStore } from './human-request-store.js';
import { EmailAllowlistStore } from './email-allowlist-store.js';
import { ProjectManager, AgentStatus } from './project-manager.js';
import { ProjectLoader } from './api-server.js';

export interface ProjectSwitchContext {
  projectLoader: ProjectLoader;
  projectsRoot: string;
  projectDir: string | null;
  orchestrator: TeamOrchestrator;
  kanbanManager: KanbanManager;
  humanRequestStore: HumanRequestStore;
  emailAllowlistStore: EmailAllowlistStore;
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
  const newProjectDir    = path.join(ctx.projectsRoot, newId);
  const newKanbanFile    = path.join(newProjectDir, 'kanban-board.json');
  const newStateFile     = path.join(newProjectDir, 'team-state.json');
  const newMcpFile       = path.join(newProjectDir, 'mcp-enabled.json');
  const newMeetingsFile  = path.join(newProjectDir, 'meetings.json');
  const newRequestsFile  = path.join(newProjectDir, 'human-requests.json');
  const newAllowlistFile = path.join(newProjectDir, 'email-allowlist.json');

  await mkdir(newProjectDir, { recursive: true });

  ctx.unsubscribeEvents?.();
  ctx.kanbanManager.closeWatcher();
  ctx.agentActivity.clear();
  ctx.agentFeeds.clear();
  ctx.agentTicketMap.clear();
  ctx.talkingTimers.forEach(t => clearTimeout(t));
  ctx.talkingTimers.clear();
  ctx.enabledMCPIds.clear();

  // Shut down the old orchestrator — saves state and disconnects all MCP processes.
  const snapshotPath = ctx.projectDir ? path.join(ctx.projectDir, 'team-state.json') : undefined;
  await ctx.orchestrator.shutdown(snapshotPath).catch((err: Error) =>
    log.warn('[API] Error shutting down old orchestrator:', err.message),
  );
  if (snapshotPath) log.info(`[API] Saved state for project "${ctx.projectDir}"`);

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
  await ctx.humanRequestStore.switchTo(newRequestsFile).catch(() => {});
  await ctx.emailAllowlistStore.switchTo(newAllowlistFile).catch(() => {});
  newOrchestrator.setEmailAllowlistStore(ctx.emailAllowlistStore);
  await ctx.loadMCPEnabled().catch(() => {});
  await ctx.projectManager.assignDefaultVisuals().catch(() => {});

  const agents        = ctx.buildAgentStatuses();
  const tickets       = await ctx.kanbanManager.readTickets().catch(() => []);
  const broadcastMeta = await ctx.projectManager.readProjectMeta();
  const project       = { id: newId, dir: newProjectDir, goal: broadcastMeta['goal'] ?? '', humanName: broadcastMeta['humanName'] ?? 'Human' };
  const requests  = ctx.humanRequestStore.list();
  const allowlist = ctx.emailAllowlistStore.list();
  ctx.sseBroadcast({ type: 'init', agents, tickets, project, requests, allowlist } as never);
  ctx.sseBroadcast({ type: 'telemetry_update', summary: ctx.projectManager.telemetry?.getSummary() ?? null });

  ctx.kanbanManager.dispatchUnstartedTickets().catch(() => {});
  log.info(`[API] Project switched to "${newId}"`);
  ctx.projectSwitchCallback?.(newOrchestrator);
}
