// ── Saving one running agent, and bringing it back ───────────────────────────
//
// An agent in a project is more than its settings: it has its threads, a
// folder of its own (memory, calendar), the scheduled actions on its agenda,
// an avatar and its logins. Capture gathers all of it; restore makes a new
// agent from it — under a new id always, and the name it is given — so a
// duplicate, a saved file and an agent sent from another machine all arrive
// the same way, and none can overwrite an agent already there.

import { existsSync } from 'fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { IAgent } from '../agent/iagent.js';
import type { AgentConfig } from '../agent/types.js';
import type { AIProvider } from '../providers/types.js';
import type { AgentDefinition, ScheduledActionDef } from '../store/team-snapshot.js';
import { configFrom, definitionOf, serializeThreads } from '../orchestrator/agent-definition.js';
import { assetPaths } from '../project/project-transfer.js';
import { AGENT_FORMAT, AGENT_VERSION, type AgentBundle } from './agent-bundle.js';

export class AgentNameTaken extends Error {}

export interface AgentSource {
  agent: IAgent;
  /** The scheduled actions on its agenda. */
  scheduledActionIds: string[];
  /** Its own folder, when a project is open. */
  agentDir?: string;
  /** The data directory, which holds avatars/ and avatars/backgrounds/. */
  dataRoot: string;
  actions: { get(id: string): ScheduledActionDef | undefined };
}

const unique = <T>(items: T[]): T[] => [...new Set(items)];

async function readFolder(dir: string | undefined): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  if (!dir || !existsSync(dir)) return files;
  for (const entry of await readdir(dir, { recursive: true })) {
    const full = path.join(dir, entry);
    if ((await stat(full)).isFile()) files.set(entry.split(path.sep).join('/'), await readFile(full));
  }
  return files;
}

export async function captureAgent(
  source: AgentSource,
  { includeCredentials }: { includeCredentials: boolean },
): Promise<AgentBundle> {
  const { agent, dataRoot } = source;
  const warnings: string[] = [];
  const definition = definitionOf(agent, source.scheduledActionIds);
  const credentials = agent.config.personalMcpCredentials;

  const scheduledActions: ScheduledActionDef[] = [];
  for (const id of unique(source.scheduledActionIds)) {
    const action = source.actions.get(id);
    if (action) scheduledActions.push(action);
    else warnings.push(`Scheduled action ${id} is on its agenda but no longer exists.`);
  }

  const assets = new Map<string, Uint8Array>();
  for (const rel of assetPaths(definition.identity)) {
    const file = path.join(dataRoot, ...rel.split('/'));
    if (existsSync(file)) assets.set(rel, await readFile(file));
    else warnings.push(`${rel} is not on this machine, so it is not included.`);
  }

  return {
    manifest: {
      format: AGENT_FORMAT,
      version: AGENT_VERSION,
      name: agent.name,
      exportedAt: new Date().toISOString(),
      includesCredentials: includeCredentials && !!credentials,
      voices: definition.identity.voice ? [definition.identity.voice] : [],
      warnings,
    },
    definition,
    threads: serializeThreads(agent),
    ...(includeCredentials && credentials && Object.keys(credentials).length > 0 && { credentials }),
    scheduledActions,
    files: await readFolder(source.agentDir),
    assets,
  };
}

/**
 * A running agent as a new library template. What it learned in this
 * project's context does not go: its team context is rebuilt for each team,
 * and its logins stay with this copy.
 */
export function templateFrom(def: AgentDefinition, name: string): AgentDefinition {
  const { templateId: _from, teamContext: _team, personalMcpCredentials: _creds, ...settings } = def;
  return { ...settings, id: randomUUID(), identity: { ...def.identity, name: name.trim() } };
}

export interface AgentTarget {
  hasAgentNamed(name: string): boolean;
  providerFor(def: AgentDefinition): AIProvider;
  register(config: AgentConfig): IAgent;
  /** Where a new agent with this id keeps its files, when a project is open. */
  agentDirFor(id: string): string | undefined;
  dataRoot: string;
  actions: { addIfMissing(def: ScheduledActionDef): Promise<boolean> };
  /** Put exactly these scheduled actions on the agent's agenda. */
  assignActions(agentName: string, actionIds: string[]): Promise<void>;
}

export interface RestoreReport {
  id: string;
  name: string;
  threads: number;
  files: number;
  scheduledActions: { added: number; kept: number };
  assets: { added: string[]; kept: string[] };
  voices: string[];
  warnings: string[];
}

export async function restoreAgent(target: AgentTarget, bundle: AgentBundle, { name }: { name: string }): Promise<RestoreReport> {
  const newName = name.trim();
  if (!newName) throw new AgentNameTaken('Give the agent a name');
  if (target.hasAgentNamed(newName)) throw new AgentNameTaken(`There is already an agent called "${newName}"`);

  const id = randomUUID();
  const definition: AgentDefinition = {
    ...bundle.definition,
    id,
    identity: { ...bundle.definition.identity, name: newName },
  };

  // Its folder first: a memory or calendar server started with the agent
  // must find what it had, not start empty and write over it.
  const dir = target.agentDirFor(id);
  if (dir) {
    for (const [rel, data] of bundle.files) {
      const file = path.join(dir, ...rel.split('/'));
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, data);
    }
  }

  const assets = { added: [] as string[], kept: [] as string[] };
  for (const [rel, data] of bundle.assets) {
    const file = path.join(target.dataRoot, ...rel.split('/'));
    // An avatar of the same name here is somebody's; leave it be.
    if (existsSync(file)) { assets.kept.push(rel); continue; }
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
    assets.added.push(rel);
  }

  const scheduledActions = { added: 0, kept: 0 };
  for (const action of bundle.scheduledActions) {
    if (await target.actions.addIfMissing(action)) scheduledActions.added++;
    else scheduledActions.kept++;
  }

  const agent = target.register(configFrom(definition, target.providerFor(definition), bundle.credentials));
  agent.setAllThreadHistories(bundle.threads);
  await target.assignActions(agent.name, definition.scheduledActionIds ?? []);

  return {
    id,
    name: agent.name,
    threads: Object.keys(bundle.threads).length,
    files: dir ? bundle.files.size : 0,
    scheduledActions,
    assets,
    voices: bundle.manifest.voices,
    warnings: [
      ...bundle.manifest.warnings,
      ...(!dir && bundle.files.size > 0 ? ['No project is open, so its memory and calendar files were not restored.'] : []),
    ],
  };
}
