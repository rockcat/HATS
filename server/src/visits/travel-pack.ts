/**
 * What an agent takes on a visit, and what it brings back. See
 * docs/team-visits.md in the HATS repository.
 *
 * Out: its settings and its own folder (memory, calendar). Not its logins,
 * which stay at home; not its conversations, which stay with its place at
 * home, the reason for the visit standing in for them; not its scheduled
 * actions, which wait at home; not avatars, which the installation shares.
 *
 * Back: what it learned, if the host lets it: its memory and nothing else.
 */

import { packAgent, unpackAgent, type AgentBundle } from '../agent-transfer/agent-bundle.js';

export const PACK_FORMAT = 'hats-visit-pack';
export const MEMORY_FILE = 'memory.json';

export interface TravelPack {
  format: typeof PACK_FORMAT;
  version: 1;
  /** An agent bundle, zipped, as base64. */
  zip: string;
}

const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

async function wrap(bundle: AgentBundle): Promise<TravelPack> {
  return { format: PACK_FORMAT, version: 1, zip: toBase64(await packAgent(bundle)) };
}

/** The pack an agent leaves home with, from a bundle captured without its logins. */
export function outgoingPack(bundle: AgentBundle): Promise<TravelPack> {
  const { personalMcpCredentials: _logins, ...definition } = bundle.definition;
  return wrap({
    ...bundle,
    definition: { ...definition, scheduledActionIds: [] },
    threads: {},
    scheduledActions: [],
    assets: new Map(),
    credentials: undefined,
  });
}

/**
 * The pack an agent moves to another team with, for good: everything but its
 * logins, which stay on this machine, and avatars, which the installation
 * shares. Unlike a visit, its conversations and schedule go with it.
 */
export function movingPack(bundle: AgentBundle): Promise<TravelPack> {
  const { personalMcpCredentials: _logins, ...definition } = bundle.definition;
  return wrap({ ...bundle, definition, assets: new Map(), credentials: undefined });
}

/** What a visitor takes home, by the host's rule; undefined when nothing goes. */
export async function returningPack(bundle: AgentBundle, memoryHome: 'all' | 'summary' | 'none'): Promise<TravelPack | undefined> {
  if (memoryHome !== 'all') return undefined;
  const memory = bundle.files.get(MEMORY_FILE);
  return wrap({
    ...bundle,
    threads: {},
    scheduledActions: [],
    assets: new Map(),
    credentials: undefined,
    files: memory ? new Map([[MEMORY_FILE, memory]]) : new Map(),
  });
}

export class PackError extends Error {}

/** The bundle inside a pack, or a PackError when it is not one. */
export async function openPack(pack: unknown): Promise<AgentBundle> {
  const p = pack as Partial<TravelPack> | null;
  if (!p || p.format !== PACK_FORMAT || typeof p.zip !== 'string') throw new PackError('Not a visit travel pack');
  return unpackAgent(new Uint8Array(Buffer.from(p.zip, 'base64')));
}

/**
 * Home memory with what was learned on a visit added. The memory server keeps
 * one JSON object per line, entities and relations, so the two are joined
 * line by line, each line once.
 */
export function mergeMemory(home: Uint8Array | undefined, visit: Uint8Array | undefined): Uint8Array | undefined {
  if (!visit) return home;
  const lines = (bytes: Uint8Array | undefined) =>
    (bytes ? Buffer.from(bytes).toString('utf8') : '').split('\n').map((l) => l.trim()).filter(Boolean);
  const merged = [...new Set([...lines(home), ...lines(visit)])];
  return new Uint8Array(Buffer.from(merged.join('\n') + (merged.length ? '\n' : ''), 'utf8'));
}
