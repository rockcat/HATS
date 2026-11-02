// ── One agent, saved: a zip ──────────────────────────────────────────────────
//
//   manifest.json            what this is, whose it is, what it needs
//   agent.json               its settings, as a team save keeps them
//   threads.json             every conversation thread it has had
//   credentials.json         its personal MCP logins, only when asked for
//   scheduled-actions.json   the actions on its agenda
//   files/<path>             its own folder: memory, calendar
//   assets/<path>            its avatar and background, under the data directory
//
// Plain JSON in a plain zip, like a project export, so it can be read by hand.

import { strFromU8, strToU8, unzip, zip, type Unzipped, type Zippable } from 'fflate';
import type { AgentDefinition, HistoryEntry, ScheduledActionDef } from '../store/team-snapshot.js';
import { ArchiveError, STORED, isSafeRelativePath } from '../project/project-archive.js';

export const AGENT_FORMAT = 'hats-agent';
export const AGENT_VERSION = 1;

export type Credentials = Record<string, Record<string, string>>;

export interface AgentManifest {
  format: typeof AGENT_FORMAT;
  version: number;
  name: string;
  exportedAt: string;
  includesCredentials: boolean;
  /** Piper voice it speaks with, which the other machine must have. */
  voices: string[];
  /** Anything that was already missing when it was saved. */
  warnings: string[];
}

export interface AgentBundle {
  manifest: AgentManifest;
  /** Without credentials: those travel only in `credentials`, and only when asked. */
  definition: AgentDefinition;
  threads: Record<string, HistoryEntry[]>;
  credentials?: Credentials;
  scheduledActions: ScheduledActionDef[];
  /** The agent's own folder, keyed by path inside it with forward slashes. */
  files: Map<string, Uint8Array>;
  /** Keyed by path under the data directory, e.g. `avatars/max.glb`. */
  assets: Map<string, Uint8Array>;
}

const json = (value: unknown): Uint8Array => strToU8(JSON.stringify(value, null, 2));

export function packAgent(bundle: AgentBundle): Promise<Uint8Array> {
  const entries: Zippable = {
    'manifest.json': json(bundle.manifest),
    'agent.json': json(bundle.definition),
    'threads.json': json(bundle.threads),
    'scheduled-actions.json': json(bundle.scheduledActions),
    ...(bundle.credentials && { 'credentials.json': json(bundle.credentials) }),
  };
  const add = (prefix: string, files: Map<string, Uint8Array>) => {
    for (const [p, bytes] of files) entries[`${prefix}/${p}`] = STORED.test(p) ? [bytes, { level: 0 }] : bytes;
  };
  add('files', bundle.files);
  add('assets', bundle.assets);
  return new Promise((resolve, reject) => {
    zip(entries, { level: 6 }, (err, data) => (err ? reject(err) : resolve(data)));
  });
}

export async function unpackAgent(bytes: Uint8Array): Promise<AgentBundle> {
  const files = await new Promise<Unzipped>((resolve, reject) => {
    unzip(bytes, (err, data) => (err ? reject(new ArchiveError(`Not a readable zip: ${err.message}`)) : resolve(data)));
  });
  const readJson = <T>(name: string, fallback?: T): T => {
    const entry = files[name];
    if (!entry) {
      if (fallback !== undefined) return fallback;
      throw new ArchiveError(`The file has no ${name}`);
    }
    try { return JSON.parse(strFromU8(entry)) as T; }
    catch { throw new ArchiveError(`${name} in the file is not valid JSON`); }
  };

  const manifest = readJson<AgentManifest>('manifest.json');
  if (manifest.format !== AGENT_FORMAT) throw new ArchiveError('This is not a saved HATS agent');
  if (manifest.version > AGENT_VERSION) {
    throw new ArchiveError(`This agent was saved as version ${manifest.version}; this runner reads up to ${AGENT_VERSION}`);
  }

  const bundle: AgentBundle = {
    manifest,
    definition: readJson<AgentDefinition>('agent.json'),
    threads: readJson<Record<string, HistoryEntry[]>>('threads.json', {}),
    scheduledActions: readJson<ScheduledActionDef[]>('scheduled-actions.json', []),
    ...(files['credentials.json'] && { credentials: readJson<Credentials>('credentials.json') }),
    files: new Map(),
    assets: new Map(),
  };
  for (const [name, data] of Object.entries(files)) {
    if (name.endsWith('/')) continue; // a directory entry from another zip tool
    if (!isSafeRelativePath(name)) throw new ArchiveError(`Refusing an unsafe path in the file: ${name}`);
    const [top, ...rest] = name.split('/');
    const inner = rest.join('/');
    if (top === 'files' && inner) bundle.files.set(inner, data);
    else if (top === 'assets' && inner) bundle.assets.set(inner, data);
  }
  return bundle;
}
