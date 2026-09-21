/**
 * The avatar catalogue — `<avatars dir>/avatars.json`.
 *
 * The file records not just which model belongs to which avatar but how to
 * frame it: camera position, rotation, field of view and scale. Without that a
 * client can download a 12 MB GLB and still have no idea where to put the
 * camera, so every renderer and every API that hands an avatar to someone else
 * reads it through here.
 *
 * Cached against the file's mtime, so editing the catalogue takes effect
 * without restarting the process.
 */

import { readFile, stat } from 'fs/promises';
import * as path from 'path';

export interface AvatarCatalogueEntry {
  name: string;
  file: string;
  sex?: string;
  camera?: [number, number, number];
  rotate?: [number, number, number];
  fov?: number;
  scale?: number;
}

/** Just the framing — what a remote client needs to render a model correctly. */
export type AvatarFraming = Pick<AvatarCatalogueEntry, 'camera' | 'rotate' | 'fov' | 'scale'>;

/**
 * Head height for a roughly human-scaled model, used when a catalogue entry
 * omits the camera. Matches the browser stage's default so an unframed avatar
 * looks the same everywhere.
 */
export const DEFAULT_CAMERA: [number, number, number] = [0, 1.65, 0.5];

interface CacheEntry {
  mtimeMs: number;
  entries: AvatarCatalogueEntry[];
}

const cache = new Map<string, CacheEntry>();

const cataloguePath = (avatarsDir: string): string => path.join(avatarsDir, 'avatars.json');

/**
 * Every entry in the catalogue. A missing or malformed file yields an empty
 * list rather than throwing: a runner with no avatars is a working runner.
 */
export async function readAvatarCatalogue(avatarsDir: string): Promise<AvatarCatalogueEntry[]> {
  const file = cataloguePath(avatarsDir);
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(file)).mtimeMs;
  } catch {
    cache.delete(file);
    return [];
  }

  const cached = cache.get(file);
  if (cached && cached.mtimeMs === mtimeMs) return cached.entries;

  try {
    const parsed = JSON.parse(await readFile(file, 'utf-8')) as { avatars?: AvatarCatalogueEntry[] };
    const entries = Array.isArray(parsed.avatars) ? parsed.avatars : [];
    cache.set(file, { mtimeMs, entries });
    return entries;
  } catch {
    cache.set(file, { mtimeMs, entries: [] });
    return [];
  }
}

/** Look up by model filename — how an agent's identity refers to its avatar. */
export async function findAvatarByFile(
  avatarsDir: string,
  file: string | undefined,
): Promise<AvatarCatalogueEntry | undefined> {
  if (!file) return undefined;
  const needle = file.toLowerCase();
  return (await readAvatarCatalogue(avatarsDir)).find((a) => a.file.toLowerCase() === needle);
}

/** Look up by catalogue name — how the offline renderers are asked for one. */
export async function findAvatarByName(
  avatarsDir: string,
  name: string,
): Promise<AvatarCatalogueEntry | undefined> {
  const needle = name.toLowerCase();
  return (await readAvatarCatalogue(avatarsDir)).find((a) => a.name?.toLowerCase() === needle);
}

/** Drop the identity fields, keeping only what a renderer needs. */
export function framingOf(entry: AvatarCatalogueEntry | undefined): AvatarFraming | undefined {
  if (!entry) return undefined;
  const framing: AvatarFraming = {};
  if (entry.camera) framing.camera = entry.camera;
  if (entry.rotate) framing.rotate = entry.rotate;
  if (entry.fov !== undefined) framing.fov = entry.fov;
  if (entry.scale !== undefined) framing.scale = entry.scale;
  return Object.keys(framing).length ? framing : undefined;
}
