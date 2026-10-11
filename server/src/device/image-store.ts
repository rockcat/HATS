// ── Keeping what the camera saw ───────────────────────────────────────────────
//
// A photo shown to the model and then dropped exists only for one turn: ask
// "what was in that picture?" two messages later and there is nothing to look
// at. So each one is written into the project beside everything else the team
// produced, and the agent is told the path.
//
// Best-effort by design. A full disk should cost the copy, not the answer —
// every failure here returns null and the picture still reaches the model.

import { mkdir, writeFile } from 'fs/promises';
import * as path from 'path';
import { log } from '../util/logger.js';

/**
 * The most we will pass on to a model.
 *
 * Anthropic rejects an image over 5MB outright, and the whole request fails
 * with it — so an oversized photo is dropped here, where the agent can be
 * told, rather than taking the answer down with it. The phone downscales
 * before sending, so reaching this means something is wrong.
 */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** Media types a model will actually accept. */
export const SUPPORTED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/**
 * Why this image cannot be shown, or null when it can.
 *
 * Phrased for the agent to read: it is the one that has to decide what to
 * do instead, and "no picture" with no reason invites it to just try again.
 */
export function rejectImage(image: { mediaType: string; base64: string }): string | null {
  if (!image.base64) return 'The device sent an empty image.';
  const type = image.mediaType?.toLowerCase().trim();
  if (!SUPPORTED_MEDIA_TYPES.includes(type)) {
    return `The device sent an image as ${image.mediaType || "an unknown type"}, which cannot be shown to you.`;
  }
  const size = decodedSize(image.base64);
  if (size > MAX_IMAGE_BYTES) {
    return `The picture was ${Math.round(size / 1024 / 1024)}MB, too large to show you `
      + `(the limit is ${MAX_IMAGE_BYTES / 1024 / 1024}MB).`;
  }
  return null;
}

/** Where device captures go, under the project directory. */
export const DEVICE_IMAGE_DIR = path.join('outputs', 'device');

/** Byte size of a base64 payload, without decoding it. */
export function decodedSize(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

/** A file extension for a media type, defaulting to .jpg — phones send JPEG. */
export function extensionFor(mediaType: string): string {
  return EXTENSIONS[mediaType.toLowerCase().trim()] ?? '.jpg';
}

/**
 * A filename that sorts by time and says where it came from.
 *
 * Colons are legal in a path on POSIX and not on Windows, so the ISO instant
 * is flattened rather than used as-is.
 */
export function imageFilename(tool: string, at: Date = new Date()): string {
  const stamp = at.toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');
  const safe = tool.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase() || 'capture';
  return `${stamp}-${safe}`;
}

/**
 * Write one image into the project.
 *
 * Returns the path the agent should be told, relative to the project so it
 * matches what the file tools use, or null when there is nowhere to put it.
 */
export async function keepDeviceImage(
  projectDir: string | null,
  tool: string,
  image: { mediaType: string; base64: string },
  now: Date = new Date(),
): Promise<string | null> {
  if (!projectDir || !image.base64) return null;

  const relative = path.join(DEVICE_IMAGE_DIR, imageFilename(tool, now) + extensionFor(image.mediaType));
  try {
    const absolute = path.join(projectDir, relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, Buffer.from(image.base64, 'base64'));
    log.info(`[Device] Kept ${decodedSize(image.base64)} bytes from "${tool}" at ${relative}`);
    return relative.split(path.sep).join('/');
  } catch (err) {
    log.warn(`[Device] Could not keep an image from "${tool}": ${(err as Error).message}`);
    return null;
  }
}
