import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import {
  decodedSize, extensionFor, imageFilename, keepDeviceImage, rejectImage, MAX_IMAGE_BYTES,
} from './image-store.js';

/** A one-pixel JPEG's worth of base64 — contents do not matter here. */
const tiny = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');

const dirs: string[] = [];
const temp = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hats-images-'));
  dirs.push(dir);
  return dir;
};
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('sizing a base64 payload', () => {
  it('measures the decoded bytes, not the encoded ones', () => {
    expect(decodedSize(Buffer.alloc(1200).toString('base64'))).toBe(1200);
  });

  it('allows for padding', () => {
    expect(decodedSize(Buffer.alloc(1).toString('base64'))).toBe(1);
    expect(decodedSize(Buffer.alloc(2).toString('base64'))).toBe(2);
    expect(decodedSize(Buffer.alloc(3).toString('base64'))).toBe(3);
  });

  it('is not fooled into a negative by an empty string', () => {
    expect(decodedSize('')).toBe(0);
  });
});

describe('deciding whether an image can be shown', () => {
  it('passes an ordinary photo', () => {
    expect(rejectImage({ mediaType: 'image/jpeg', base64: tiny })).toBeNull();
  });

  it('refuses one too large for the model, saying how large', () => {
    // Anthropic fails the whole request over this, taking the answer with it.
    const huge = 'A'.repeat(Math.ceil((MAX_IMAGE_BYTES + 1024) * 4 / 3));
    const refusal = rejectImage({ mediaType: 'image/jpeg', base64: huge });

    expect(refusal).toContain('too large');
    expect(refusal).toMatch(/\d+MB/);
  });

  it('refuses a type no model takes, naming it', () => {
    expect(rejectImage({ mediaType: 'image/heic', base64: tiny })).toContain('image/heic');
  });

  it('refuses an empty image', () => {
    expect(rejectImage({ mediaType: 'image/jpeg', base64: '' })).toContain('empty');
  });

  it('does not care about case or stray spaces in the type', () => {
    expect(rejectImage({ mediaType: ' IMAGE/JPEG ', base64: tiny })).toBeNull();
  });
});

describe('naming a kept image', () => {
  it('sorts by time and says which tool took it', () => {
    const name = imageFilename('take_photo', new Date('2026-10-11T14:56:25.722Z'));
    expect(name).toBe('2026-10-11T14-56-25-722-take_photo');
  });

  it('avoids characters a Windows path rejects', () => {
    // An ISO instant has colons in it, which are legal on POSIX and not here.
    expect(imageFilename('take_photo', new Date())).not.toContain(':');
  });

  it('does not let a tool name escape the directory', () => {
    const name = imageFilename('../../etc/passwd');
    expect(name).not.toContain('..');
    expect(name).not.toContain('/');
  });

  it('matches the extension to the type, defaulting to jpg', () => {
    expect(extensionFor('image/png')).toBe('.png');
    expect(extensionFor('image/webp')).toBe('.webp');
    expect(extensionFor('IMAGE/JPEG')).toBe('.jpg');
    expect(extensionFor('application/octet-stream')).toBe('.jpg');
  });
});

describe('keeping an image in the project', () => {
  it('writes the real bytes, under outputs/device', async () => {
    const project = await temp();
    const kept = await keepDeviceImage(project, 'take_photo', { mediaType: 'image/jpeg', base64: tiny });

    expect(kept).toMatch(/^outputs\/device\/.*\.jpg$/);
    const written = await readFile(path.join(project, kept!));
    expect(written).toEqual(Buffer.from(tiny, 'base64'));
  });

  it('returns a path with forward slashes, as the file tools use', async () => {
    // The agent is handed this to pass to read_file; a backslash would not
    // survive the round trip on Windows.
    const kept = await keepDeviceImage(await temp(), 'take_photo', { mediaType: 'image/jpeg', base64: tiny });
    expect(kept).not.toContain('\\');
  });

  it('creates the directory rather than failing on a fresh project', async () => {
    const kept = await keepDeviceImage(await temp(), 'take_photo', { mediaType: 'image/png', base64: tiny });
    expect(kept).toMatch(/\.png$/);
  });

  it('keeps two photos taken in the same second apart', async () => {
    const project = await temp();
    const first = await keepDeviceImage(project, 'take_photo', { mediaType: 'image/jpeg', base64: tiny },
      new Date('2026-10-11T14:56:25.100Z'));
    const second = await keepDeviceImage(project, 'take_photo', { mediaType: 'image/jpeg', base64: tiny },
      new Date('2026-10-11T14:56:25.900Z'));

    expect(first).not.toBe(second);
  });

  it('declines quietly when there is no project to keep it in', async () => {
    // A picture is still worth showing the model when there is nowhere to
    // file it, so this is null rather than a throw.
    expect(await keepDeviceImage(null, 'take_photo', { mediaType: 'image/jpeg', base64: tiny })).toBeNull();
  });

  it('declines quietly when the write fails', async () => {
    const kept = await keepDeviceImage(
      path.join(await temp(), 'nested\u0000illegal'), 'take_photo',
      { mediaType: 'image/jpeg', base64: tiny });
    expect(kept).toBeNull();
  });
});
