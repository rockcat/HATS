// ── First-run data ──────────────────────────────────────────────────────────
//
// The image carries the defaults this repository ships under runtime_data —
// the avatars, their backgrounds, model pricing. A new installation starts
// with an empty data directory, so on startup anything missing is copied in.
// Nothing already there is ever replaced: once copied, a file is the
// installation's own to edit or delete.

import { copyFile, mkdir, readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';

/** Copy every file under `from` that `to` lacks. Returns the relative paths copied. */
export async function seedMissing(from: string, to: string): Promise<string[]> {
  if (!existsSync(from)) return [];
  const copied: string[] = [];
  for (const entry of await readdir(from, { recursive: true })) {
    const source = path.join(from, entry);
    if (!(await stat(source)).isFile()) continue;
    const target = path.join(to, entry);
    if (existsSync(target)) continue;
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
    copied.push(entry.split(path.sep).join('/'));
  }
  return copied;
}
