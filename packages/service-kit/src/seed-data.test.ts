import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { seedMissing } from './seed-data.js';

let from: string;
let to: string;

beforeEach(async () => {
  from = await mkdtemp(path.join(tmpdir(), 'hats-defaults-'));
  to = await mkdtemp(path.join(tmpdir(), 'hats-data-'));
  await mkdir(path.join(from, 'avatars', 'backgrounds'), { recursive: true });
  await writeFile(path.join(from, 'avatars', 'max.glb'), 'default');
  await writeFile(path.join(from, 'avatars', 'backgrounds', 'office.png'), 'default');
});

afterEach(async () => {
  await rm(from, { recursive: true, force: true });
  await rm(to, { recursive: true, force: true });
});

describe('seedMissing', () => {
  it('fills an empty data directory', async () => {
    const copied = await seedMissing(from, to);
    expect(copied.sort()).toEqual(['avatars/backgrounds/office.png', 'avatars/max.glb']);
    expect(await readFile(path.join(to, 'avatars', 'backgrounds', 'office.png'), 'utf8')).toBe('default');
  });

  it('never replaces a file the installation already has', async () => {
    await mkdir(path.join(to, 'avatars'), { recursive: true });
    await writeFile(path.join(to, 'avatars', 'max.glb'), 'edited');

    expect(await seedMissing(from, to)).toEqual(['avatars/backgrounds/office.png']);
    expect(await readFile(path.join(to, 'avatars', 'max.glb'), 'utf8')).toBe('edited');
  });

  it('copies nothing the second time', async () => {
    await seedMissing(from, to);
    expect(await seedMissing(from, to)).toEqual([]);
  });

  it('does nothing when there are no defaults', async () => {
    expect(await seedMissing(path.join(from, 'absent'), to)).toEqual([]);
  });
});
