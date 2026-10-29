/**
 * Opening the project folder for the person at the machine.
 *
 * Only possible when the runner runs on that machine, outside a container. In
 * Docker there is no desktop to open it on — and no xdg-open either, whose
 * missing-command error, unhandled, used to take the whole runner down. There
 * the answer is where to find the folder instead.
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import * as path from 'path';
import { runtimeDir } from '../../../packages/core/src/runtime-dir.js';

export interface OpenFolderResult {
  opened: boolean;
  /** Where to find the folder: the host's path when known, else the runner's. */
  path: string;
  /** True when path is relative to the installation's data folder. */
  inDataFolder?: boolean;
  error?: string;
}

/** The command that shows a folder in this platform's file manager. */
export function folderOpener(dir: string, platform: NodeJS.Platform = process.platform): [string, string[]] {
  if (platform === 'win32') return ['explorer.exe', [dir]];
  if (platform === 'darwin') return ['open', [dir]];
  return ['xdg-open', [dir]];
}

export function inContainer(exists: (p: string) => boolean = existsSync): boolean {
  return exists('/.dockerenv') || exists('/run/.containerenv');
}

/**
 * The folder as someone on the host would find it. Compose may say where the
 * data folder is mounted from (HATS_HOST_DATA); without that, the path within
 * the data folder is the most that can be said.
 */
export function hostPath(
  dir: string,
  dataDir: string = runtimeDir(),
  hostData: string | undefined = process.env['HATS_HOST_DATA'],
): Pick<OpenFolderResult, 'path' | 'inDataFolder'> {
  const rel = path.relative(dataDir, dir);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return { path: dir };
  const within = rel.split(path.sep).join('/');
  if (hostData) return { path: `${hostData.replace(/[\\/]+$/, '')}/${within}` };
  return { path: within, inDataFolder: true };
}

export function openFolder(dir: string): Promise<OpenFolderResult> {
  if (inContainer()) return Promise.resolve({ opened: false, ...hostPath(dir) });
  const [cmd, args] = folderOpener(dir);
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.once('error', (err) => resolve({ opened: false, path: dir, error: `${cmd}: ${err.message}` }));
    child.once('spawn', () => { child.unref(); resolve({ opened: true, path: dir }); });
  });
}
