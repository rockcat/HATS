/**
 * The project's files — sources, outputs and ticket work — as one zip.
 *
 * What the Project Files pane offers where the runner cannot open the folder
 * itself: in Docker there is no desktop to open it on, but the browser can
 * always download.
 */

import { readdir, readFile } from 'fs/promises';
import * as path from 'path';
import { zip, type Zippable } from 'fflate';
import { listFilesRecursive } from './api-utils.js';
import { STORED } from '../project/project-archive.js';

/** The folders of a project that hold its files, as against its state. */
export async function fileFolders(projectDir: string): Promise<string[]> {
  const entries = await readdir(projectDir, { withFileTypes: true }).catch(() => []);
  const tickets = entries.filter(e => e.isDirectory() && /^TKT-/i.test(e.name)).map(e => e.name).sort();
  return ['sources', 'outputs', ...tickets];
}

export async function zipProjectFiles(projectDir: string): Promise<Uint8Array> {
  const entries: Zippable = {};
  for (const folder of await fileFolders(projectDir)) {
    for (const f of await listFilesRecursive(path.join(projectDir, folder), projectDir, folder)) {
      if (f.isDir) continue;
      const bytes = new Uint8Array(await readFile(path.join(projectDir, ...f.relativePath.split('/'))));
      entries[f.relativePath] = STORED.test(f.name) ? [bytes, { level: 0 }] : bytes;
    }
  }
  return new Promise((resolve, reject) => {
    zip(entries, { level: 6 }, (err, data) => (err ? reject(err) : resolve(data)));
  });
}
