import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import {
  DEFAULT_CAMERA, findAvatarByFile, findAvatarByName, framingOf, readAvatarCatalogue,
} from './avatar-catalogue.js';

let dir = '';
let empty = '';

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'hats-avatars-'));
  empty = await mkdtemp(path.join(tmpdir(), 'hats-avatars-empty-'));
  await writeFile(path.join(dir, 'avatars.json'), JSON.stringify({
    avatars: [
      { name: 'Casey', file: 'casey.glb', camera: [0, 1.65, 0.5], rotate: [0, 0, 0], fov: 50, scale: 1 },
      { name: 'Jean', file: 'jean.vrm' },
    ],
  }));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(empty, { recursive: true, force: true });
});

describe('readAvatarCatalogue', () => {
  it('reads every entry', async () => {
    expect((await readAvatarCatalogue(dir)).map((a) => a.file)).toEqual(['casey.glb', 'jean.vrm']);
  });

  it('treats a missing catalogue as no avatars rather than an error', async () => {
    await expect(readAvatarCatalogue(empty)).resolves.toEqual([]);
  });

  it('picks up an edit without needing a restart', async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), 'hats-avatars-edit-'));
    const file = path.join(scratch, 'avatars.json');
    await writeFile(file, JSON.stringify({ avatars: [{ name: 'One', file: 'one.glb' }] }));
    expect(await readAvatarCatalogue(scratch)).toHaveLength(1);

    // A same-millisecond rewrite would keep the cached mtime, so nudge it.
    await new Promise((resolve) => setTimeout(resolve, 10));
    await writeFile(file, JSON.stringify({ avatars: [{ name: 'One', file: 'one.glb' }, { name: 'Two', file: 'two.glb' }] }));
    expect(await readAvatarCatalogue(scratch)).toHaveLength(2);

    await rm(scratch, { recursive: true, force: true });
  });
});

describe('lookups', () => {
  it('finds by model filename, which is how an agent identity refers to one', async () => {
    expect((await findAvatarByFile(dir, 'CASEY.GLB'))?.name).toBe('Casey');
  });

  it('finds by catalogue name, which is how the offline renderers ask', async () => {
    expect((await findAvatarByName(dir, 'jean'))?.file).toBe('jean.vrm');
  });

  it('returns nothing for an avatar that is not in the catalogue', async () => {
    expect(await findAvatarByFile(dir, 'dave.glb')).toBeUndefined();
    expect(await findAvatarByFile(dir, undefined)).toBeUndefined();
  });
});

describe('framingOf', () => {
  it('keeps only the placement fields', async () => {
    const entry = await findAvatarByFile(dir, 'casey.glb');
    expect(framingOf(entry)).toEqual({ camera: [0, 1.65, 0.5], rotate: [0, 0, 0], fov: 50, scale: 1 });
  });

  it('is undefined when the entry says nothing about framing', async () => {
    expect(framingOf(await findAvatarByFile(dir, 'jean.vrm'))).toBeUndefined();
    expect(framingOf(undefined)).toBeUndefined();
  });

  it('offers a head-height default for a model nobody framed', () => {
    expect(DEFAULT_CAMERA).toEqual([0, 1.65, 0.5]);
  });
});
