// ── The exported project: one zip ───────────────────────────────────────────
//
//   manifest.json            what this is, who is in it, what it needs
//   definition.json          the project as the Project Server holds it
//   templates/<id>.json      each agent's library template
//   secrets.json             each agent's team context, and credentials if asked
//   scheduled-actions.json   the actions its agents run
//   assets/<path>            avatars and backgrounds the agents use
//   project/<path>           the project folder; project.db is one snapshot
//
// Plain JSON in a plain zip, so an export can be opened and read by hand.
// Piper voices are listed in the manifest rather than carried: they are large,
// shared by every project, and downloadable.

import { strFromU8, strToU8, unzip, zip, type Unzipped, type Zippable } from 'fflate';
import type { AgentTemplate, ProjectDefinition } from '../../../packages/contracts/src/types.js';
import type { AgentSecrets } from '../api/agent-store.js';
import type { ScheduledActionDef } from '../store/team-snapshot.js';

export const ARCHIVE_FORMAT = 'hats-project';
export const ARCHIVE_VERSION = 1;

export interface ArchiveManifest {
  format: typeof ARCHIVE_FORMAT;
  version: number;
  projectId: string;
  projectName: string;
  exportedAt: string;
  includesCredentials: boolean;
  agents: Array<{ id: string; name: string }>;
  /** Piper voices the agents speak with, which the new machine must have. */
  voices: string[];
  /** Anything the export noticed was already missing on this machine. */
  warnings: string[];
}

export interface ProjectArchive {
  manifest: ArchiveManifest;
  definition: ProjectDefinition;
  templates: AgentTemplate[];
  secrets: Record<string, AgentSecrets>;
  scheduledActions: ScheduledActionDef[];
  /** Keyed by path under the data directory, e.g. `avatars/max.glb`. */
  assets: Map<string, Uint8Array>;
  /** Keyed by path inside the project folder, always with forward slashes. */
  projectFiles: Map<string, Uint8Array>;
}

export class ArchiveError extends Error {}

/** A relative path that cannot climb out of the folder it is written into. */
export function isSafeRelativePath(p: string): boolean {
  if (!p || p.startsWith('/') || p.includes('\\') || /^[A-Za-z]:/.test(p)) return false;
  return p.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

const json = (value: unknown): Uint8Array => strToU8(JSON.stringify(value, null, 2));

/** Formats that are already compressed gain nothing from a second pass. */
const STORED = /\.(glb|vrm|png|jpe?g|webp|gif|mp3|mp4|zip|onnx)$/i;

export function packArchive(archive: ProjectArchive): Promise<Uint8Array> {
  const entries: Zippable = {
    'manifest.json': json(archive.manifest),
    'definition.json': json(archive.definition),
    'secrets.json': json(archive.secrets),
    'scheduled-actions.json': json(archive.scheduledActions),
  };
  for (const t of archive.templates) entries[`templates/${t.id}.json`] = json(t);
  const add = (prefix: string, files: Map<string, Uint8Array>) => {
    for (const [p, bytes] of files) {
      entries[`${prefix}/${p}`] = STORED.test(p) ? [bytes, { level: 0 }] : bytes;
    }
  };
  add('assets', archive.assets);
  add('project', archive.projectFiles);

  return new Promise((resolve, reject) => {
    zip(entries, { level: 6 }, (err, data) => (err ? reject(err) : resolve(data)));
  });
}

export async function unpackArchive(bytes: Uint8Array): Promise<ProjectArchive> {
  const files = await new Promise<Unzipped>((resolve, reject) => {
    unzip(bytes, (err, data) => (err ? reject(new ArchiveError(`Not a readable zip: ${err.message}`)) : resolve(data)));
  });

  const readJson = <T>(name: string, fallback?: T): T => {
    const entry = files[name];
    if (!entry) {
      if (fallback !== undefined) return fallback;
      throw new ArchiveError(`The archive has no ${name}`);
    }
    try { return JSON.parse(strFromU8(entry)) as T; }
    catch { throw new ArchiveError(`${name} in the archive is not valid JSON`); }
  };

  const manifest = readJson<ArchiveManifest>('manifest.json');
  if (manifest.format !== ARCHIVE_FORMAT) throw new ArchiveError('This is not a HATS project export');
  if (manifest.version > ARCHIVE_VERSION) {
    throw new ArchiveError(`This export is version ${manifest.version}; this runner reads up to ${ARCHIVE_VERSION}`);
  }

  const archive: ProjectArchive = {
    manifest,
    definition: readJson<ProjectDefinition>('definition.json'),
    templates: [],
    secrets: readJson<Record<string, AgentSecrets>>('secrets.json', {}),
    scheduledActions: readJson<ScheduledActionDef[]>('scheduled-actions.json', []),
    assets: new Map(),
    projectFiles: new Map(),
  };

  for (const [name, data] of Object.entries(files)) {
    if (name.endsWith('/')) continue; // a directory entry from another zip tool
    if (!isSafeRelativePath(name)) throw new ArchiveError(`Refusing an unsafe path in the archive: ${name}`);
    const [top, ...rest] = name.split('/');
    const inner = rest.join('/');
    if (top === 'templates' && inner.endsWith('.json')) archive.templates.push(readJson<AgentTemplate>(name));
    else if (top === 'assets' && inner) archive.assets.set(inner, data);
    else if (top === 'project' && inner) archive.projectFiles.set(inner, data);
  }
  return archive;
}
