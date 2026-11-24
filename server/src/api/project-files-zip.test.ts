import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { unzipSync, strFromU8 } from 'fflate';
import { zipProjectFiles } from './project-files-zip.js';

let dir = '';

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'hats-files-zip-'));
  for (const sub of ['sources', 'outputs/drafts', 'TKT-007', 'agents']) await mkdir(path.join(dir, sub), { recursive: true });
  await writeFile(path.join(dir, 'sources', 'brief.txt'), 'the brief');
  await writeFile(path.join(dir, 'outputs', 'drafts', 'plan.md'), '# Plan');
  await writeFile(path.join(dir, 'TKT-007', 'notes.md'), 'notes');
  await writeFile(path.join(dir, 'agents', 'memory.json'), '{}');
  await writeFile(path.join(dir, 'team-state.json'), '{}');
});

afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('the project\'s files as a zip', () => {
  it('holds sources, outputs and ticket work, as they are laid out', async () => {
    const files = unzipSync(await zipProjectFiles(dir));
    expect(Object.keys(files).sort()).toEqual(['TKT-007/notes.md', 'outputs/drafts/plan.md', 'sources/brief.txt']);
    expect(strFromU8(files['outputs/drafts/plan.md']!)).toBe('# Plan');
  });

  it('is empty, not an error, for a project with no files yet', async () => {
    const empty = await mkdtemp(path.join(tmpdir(), 'hats-files-zip-'));
    expect(Object.keys(unzipSync(await zipProjectFiles(empty)))).toEqual([]);
    await rm(empty, { recursive: true, force: true });
  });
});
