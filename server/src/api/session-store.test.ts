import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { SessionStore, SESSION_TTL } from './session-store.js';

const user = { id: 'u1', username: 'alice', role: 'admin' as const };

let dir: string | null = null;
async function tempFile(): Promise<string> {
  dir = await mkdtemp(path.join(tmpdir(), 'sessions-'));
  return path.join(dir, 'sessions.json');
}

afterEach(async () => {
  vi.useRealTimers();
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = null;
});

describe('SessionStore', () => {
  it('keeps sessions across a restart', async () => {
    const file  = await tempFile();
    const first = new SessionStore();
    await first.load(file);
    const id = first.create(user);
    await first.flushed();

    const second = new SessionStore();
    await second.load(file);
    expect(second.get(id)).toMatchObject({ userId: 'u1', username: 'alice' });
  });

  it('forgets a deleted session on disk too', async () => {
    const file  = await tempFile();
    const first = new SessionStore();
    await first.load(file);
    const id = first.create(user);
    first.delete(id);
    await first.flushed();

    const second = new SessionStore();
    await second.load(file);
    expect(second.get(id)).toBeNull();
  });

  it('drops expired sessions when loading', async () => {
    const file = await tempFile();
    await writeFile(file, JSON.stringify({
      old: { ...user, userId: 'u1', expiresAt: Date.now() - 1 },
    }));
    const store = new SessionStore();
    await store.load(file);
    expect(store.get('old')).toBeNull();
  });

  it('renews a session that is in use', () => {
    vi.useFakeTimers();
    const store = new SessionStore();
    const id = store.create(user);

    vi.advanceTimersByTime(SESSION_TTL - 1000);
    expect(store.get(id)).not.toBeNull();

    vi.advanceTimersByTime(SESSION_TTL - 1000);
    expect(store.get(id)).not.toBeNull();
  });

  it('expires a session left unused', () => {
    vi.useFakeTimers();
    const store = new SessionStore();
    const id = store.create(user);
    vi.advanceTimersByTime(SESSION_TTL + 1);
    expect(store.get(id)).toBeNull();
  });

  it('works without a file', async () => {
    const store = new SessionStore();
    const id = store.create(user);
    await store.flushed();
    expect(store.get(id)).not.toBeNull();
  });

  it('saves the file readable as JSON', async () => {
    const file  = await tempFile();
    const store = new SessionStore();
    await store.load(file);
    const id = store.create(user);
    await store.flushed();
    expect(Object.keys(JSON.parse(await readFile(file, 'utf-8')))).toEqual([id]);
  });
});
