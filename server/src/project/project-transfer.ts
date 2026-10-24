// ── Moving a project between machines ───────────────────────────────────────
//
// A project is more than its folder. Its team is in the Project Server's
// definition, each agent's template is in the Agent Library, and credentials
// and scheduled actions sit in files shared by every project. Export gathers
// all of it into one archive; import puts each piece back where it belongs,
// adding to what the new machine already has and never overwriting it.

import { existsSync } from 'fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { isValidProjectId } from '../../../packages/contracts/src/factories.js';
import type { AgentTemplate, AgentTemplateInput, ProjectDefinition } from '../../../packages/contracts/src/types.js';
import type { AgentLibraryClient } from '../../../packages/clients/src/agent-library-client.js';
import type { ProjectServerClient } from '../../../packages/clients/src/project-server-client.js';
import type { AgentSecrets } from '../api/agent-store.js';
import type { ScheduledActionDef } from '../store/team-snapshot.js';
import { snapshotProjectDb } from '../store/project-db.js';
import {
  ARCHIVE_FORMAT, ARCHIVE_VERSION, ArchiveError, isSafeRelativePath,
  packArchive, unpackArchive, type ArchiveManifest, type ProjectArchive,
} from './project-archive.js';

export interface TransferDeps {
  projectsRoot: string;
  /** The data directory: avatars/, avatars/backgrounds/ and piper_voices/ live here. */
  dataRoot: string;
  projectServer: Pick<ProjectServerClient, 'getProject' | 'createProject'>;
  library: Pick<AgentLibraryClient, 'getTemplate' | 'putTemplate'>;
  secrets: {
    get(id: string): AgentSecrets;
    set(id: string, secrets: AgentSecrets): Promise<void>;
  };
  actions: {
    get(id: string): ScheduledActionDef | undefined;
    addIfMissing(def: ScheduledActionDef): Promise<boolean>;
  };
}

export class TransferConflict extends Error {}
export class TransferNotFound extends Error {}

/** SQLite's own files. The database travels as one snapshot instead. */
const DB_FILES = new Set(['project.db', 'project.db-wal', 'project.db-shm', 'project.db-journal']);

type Identity = { avatar?: string; background?: string; voice?: string };

const assetPaths = (identity: Identity): string[] => [
  ...(identity.avatar ? [`avatars/${identity.avatar}`] : []),
  ...(identity.background ? [`avatars/backgrounds/${identity.background}`] : []),
];

const voiceFile = (dataRoot: string, voice: string) => path.join(dataRoot, 'piper_voices', `${voice}.onnx`);

const unique = <T>(items: T[]): T[] => [...new Set(items)];

// ── Export ──────────────────────────────────────────────────────────────────

export async function exportProject(
  deps: TransferDeps,
  projectId: string,
  options: { includeCredentials: boolean },
): Promise<{ bytes: Uint8Array; manifest: ArchiveManifest }> {
  const definition = await deps.projectServer.getProject(projectId);
  if (!definition) throw new TransferNotFound(`There is no project "${projectId}"`);
  const warnings: string[] = [];

  const templates: AgentTemplate[] = [];
  for (const templateId of unique(definition.team.map((a) => a.templateId).filter((id): id is string => !!id))) {
    const template = await deps.library.getTemplate(templateId);
    if (template) templates.push(template);
    else warnings.push(`Template ${templateId} is not in the library; its agent travels in the definition only.`);
  }

  const secrets: Record<string, AgentSecrets> = {};
  for (const id of unique(definition.team.flatMap((a) => [a.instanceId, a.templateId ?? a.instanceId]))) {
    const { personalMcpCredentials, teamContext } = deps.secrets.get(id);
    const kept: AgentSecrets = {
      ...(teamContext && { teamContext }),
      ...(options.includeCredentials && personalMcpCredentials && { personalMcpCredentials }),
    };
    if (Object.keys(kept).length > 0) secrets[id] = kept;
  }

  const scheduledActions: ScheduledActionDef[] = [];
  const actionOwners = [...definition.team, ...templates];
  for (const id of unique(actionOwners.flatMap((a) => a.scheduledActionIds ?? []))) {
    const action = deps.actions.get(id);
    if (action) scheduledActions.push(action);
    else warnings.push(`Scheduled action ${id} is referenced by an agent but no longer exists.`);
  }

  const identities: Identity[] = [...definition.team, ...templates].map((a) => a.identity);
  const assets = new Map<string, Uint8Array>();
  for (const rel of unique(identities.flatMap(assetPaths))) {
    const file = path.join(deps.dataRoot, ...rel.split('/'));
    if (existsSync(file)) assets.set(rel, await readFile(file));
    else warnings.push(`${rel} is not on this machine, so it is not in the export.`);
  }
  const voices = unique(identities.map((i) => i.voice).filter((v): v is string => !!v));

  const manifest: ArchiveManifest = {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    projectId: definition.id,
    projectName: definition.name,
    exportedAt: new Date().toISOString(),
    includesCredentials: options.includeCredentials,
    agents: definition.team.map((a) => ({ id: a.instanceId, name: a.name })),
    voices,
    warnings,
  };

  const projectFiles = await readProjectFolder(path.join(deps.projectsRoot, projectId));
  const bytes = await packArchive({ manifest, definition, templates, secrets, scheduledActions, assets, projectFiles });
  return { bytes, manifest };
}

async function readProjectFolder(dir: string): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  if (!existsSync(dir)) return files;

  for (const entry of await readdir(dir, { recursive: true })) {
    const rel = entry.split(path.sep).join('/');
    if (DB_FILES.has(rel)) continue;
    const full = path.join(dir, entry);
    if ((await stat(full)).isFile()) files.set(rel, await readFile(full));
  }

  const db = path.join(dir, 'project.db');
  if (existsSync(db)) {
    const snapshot = path.join(tmpdir(), `hats-export-${randomUUID()}.db`);
    try {
      snapshotProjectDb(db, snapshot);
      files.set('project.db', await readFile(snapshot));
    } finally {
      await rm(snapshot, { force: true });
    }
  }
  return files;
}

// ── Import ──────────────────────────────────────────────────────────────────

export interface ImportReport {
  projectId: string;
  templates: { created: string[]; kept: string[] };
  /** Agents whose team context or credentials were added on this machine. */
  secrets: string[];
  scheduledActions: { added: number; kept: number };
  assets: { added: string[]; kept: string[] };
  /** Voices the agents use that this machine does not have. */
  missingVoices: string[];
  /** Carried over from the export. */
  warnings: string[];
}

export async function importProject(
  deps: TransferDeps,
  bytes: Uint8Array,
  options: { as?: string } = {},
): Promise<ImportReport> {
  const archive = await unpackArchive(bytes);
  const renamed = !!options.as?.trim();
  const projectId = renamed ? options.as!.trim() : archive.manifest.projectId;
  if (!isValidProjectId(projectId)) throw new ArchiveError(`"${projectId}" is not a valid project id`);

  const projectDir = path.join(deps.projectsRoot, projectId);
  if (await deps.projectServer.getProject(projectId)) {
    throw new TransferConflict(`A project "${projectId}" already exists here — import it under another id`);
  }
  if (existsSync(projectDir) && (await readdir(projectDir)).length > 0) {
    throw new TransferConflict(`${projectDir} already exists and is not empty`);
  }

  await writeProjectFolder(projectDir, archive.projectFiles);
  try {
    await createDefinition(deps, archive.definition, projectId, renamed);
  } catch (err) {
    await rm(projectDir, { recursive: true, force: true });
    throw err;
  }

  return {
    projectId,
    templates: await importTemplates(deps, archive.templates),
    secrets: await importSecrets(deps, archive.secrets),
    scheduledActions: await importActions(deps, archive.scheduledActions),
    assets: await importAssets(deps, archive.assets),
    missingVoices: archive.manifest.voices.filter((v) => !existsSync(voiceFile(deps.dataRoot, v))),
    warnings: [...archive.manifest.warnings],
  };
}

async function writeProjectFolder(dir: string, files: ProjectArchive['projectFiles']): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const [rel, data] of files) {
    if (!isSafeRelativePath(rel)) throw new ArchiveError(`Refusing an unsafe path in the archive: ${rel}`);
    const target = path.join(dir, ...rel.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
  }
}

async function createDefinition(
  deps: TransferDeps, definition: ProjectDefinition, id: string, renamed: boolean,
): Promise<void> {
  const created = await deps.projectServer.createProject({
    id,
    name: renamed ? id : definition.name,
    team: definition.team,
    ...(definition.description !== undefined && { description: definition.description }),
    ...(definition.goal !== undefined && { goal: definition.goal }),
    ...(definition.humanName !== undefined && { humanName: definition.humanName }),
    ...(definition.mcpServers !== undefined && { mcpServers: definition.mcpServers }),
    ...(definition.settings !== undefined && { settings: definition.settings }),
  });
  if (!created) throw new Error(`The Project Server did not create "${id}"`);
}

function templateInput(template: AgentTemplate): AgentTemplateInput {
  const { schemaVersion: _s, id: _i, revision: _r, createdAt: _c, updatedAt: _u, ...input } = template;
  return input;
}

/** A template already here is the same agent, perhaps edited since: it is kept. */
async function importTemplates(deps: TransferDeps, templates: AgentTemplate[]): Promise<ImportReport['templates']> {
  const report = { created: [] as string[], kept: [] as string[] };
  for (const template of templates) {
    if (await deps.library.getTemplate(template.id)) { report.kept.push(template.name); continue; }
    await deps.library.putTemplate(template.id, templateInput(template));
    report.created.push(template.name);
  }
  return report;
}

/** What this machine already holds for an agent wins; the archive fills gaps. */
async function importSecrets(deps: TransferDeps, secrets: Record<string, AgentSecrets>): Promise<string[]> {
  const changed: string[] = [];
  for (const [id, incoming] of Object.entries(secrets)) {
    const existing = deps.secrets.get(id);
    const credentials = { ...incoming.personalMcpCredentials, ...existing.personalMcpCredentials };
    const merged: AgentSecrets = {
      ...incoming,
      ...existing,
      ...(Object.keys(credentials).length > 0 && { personalMcpCredentials: credentials }),
    };
    if (JSON.stringify(merged) === JSON.stringify(existing)) continue;
    await deps.secrets.set(id, merged);
    changed.push(id);
  }
  return changed;
}

async function importActions(
  deps: TransferDeps, actions: ScheduledActionDef[],
): Promise<ImportReport['scheduledActions']> {
  let added = 0;
  for (const action of actions) if (await deps.actions.addIfMissing(action)) added++;
  return { added, kept: actions.length - added };
}

async function importAssets(deps: TransferDeps, assets: ProjectArchive['assets']): Promise<ImportReport['assets']> {
  const report = { added: [] as string[], kept: [] as string[] };
  for (const [rel, data] of assets) {
    if (!isSafeRelativePath(rel) || !rel.startsWith('avatars/')) {
      throw new ArchiveError(`Refusing an unexpected asset path in the archive: ${rel}`);
    }
    const target = path.join(deps.dataRoot, ...rel.split('/'));
    if (existsSync(target)) { report.kept.push(rel); continue; }
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
    report.added.push(rel);
  }
  return report;
}
