import * as path from 'path';
import { mkdir } from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { log } from '../util/logger.js';
import { HatType } from '../hats/types.js';
import { Agent } from '../agent/agent.js';
import { Task, TeamMessage } from './types.js';
import { toProjectSlug } from './orchestrator-utils.js';

export function deliverToAgent(
  agents: Map<string, Agent>,
  lastSenderByAgent: Map<string, string>,
  name: string,
  message: TeamMessage,
): void {
  let target: Agent | undefined;
  for (const a of agents.values()) {
    if (a.name === name) { target = a; break; }
  }
  if (target) {
    if (message.from !== 'system') lastSenderByAgent.set(name, message.from);
    target.receive(message);
  } else {
    log.warn(`[Orchestrator] No agent "${name}" to deliver message to`);
  }
}

export function findBlueHat(agents: Map<string, Agent>): Agent | undefined {
  for (const a of agents.values()) {
    if (a.hatType === HatType.Blue) return a;
  }
  return undefined;
}

export async function createTask(
  tasks: Map<string, Task>,
  projectsRoot: string,
  assignedTo: string,
  assignedBy: string,
  description: string,
  context?: string,
  projectName?: string,
): Promise<string> {
  const taskId = uuidv4();
  const slug = projectName ? toProjectSlug(projectName) : toProjectSlug(description);
  const projectFolder = path.join(projectsRoot, slug);
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
  tasks.set(taskId, task);
  return taskId;
}

export function resolveAgentPath(
  tasks: Map<string, Task>,
  projectDir: string | null,
  agentName: string,
  filePath: string,
): string {
  if (path.isAbsolute(filePath)) return filePath;
  const activeTask = Array.from(tasks.values()).find(
    (t) => t.status === 'active' && t.assignedTo.toLowerCase() === agentName.toLowerCase(),
  );
  const base = activeTask?.projectFolder ?? projectDir ?? process.cwd();
  return path.resolve(base, filePath);
}
