import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { HumanRequestStore } from './human-request-store.js';
import type { HumanRequest } from '../orchestrator/types.js';

let dir = '';
let file = '';
let store: HumanRequestStore;

const request = (id: string, over: Partial<HumanRequest> = {}): HumanRequest => ({
  id,
  agentName: 'Poppy',
  message: 'Which mailbox should I file these under?',
  urgency: 'low',
  status: 'pending',
  createdAt: `2026-09-25T10:0${id.slice(-1)}:00.000Z`,
  ...over,
});

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'hats-requests-'));
  file = path.join(dir, 'human-requests.json');
  store = new HumanRequestStore(file);
  await store.load();
});

afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

const onDisk = async (): Promise<HumanRequest[]> =>
  JSON.parse(await readFile(file, 'utf-8')) as HumanRequest[];

describe('dismiss', () => {
  it('settles a request without an answer', async () => {
    await store.add(request('r1'));
    const dismissed = await store.dismiss('r1');
    expect(dismissed?.status).toBe('dismissed');
    expect(dismissed?.dismissedAt).toBeTypeOf('string');
    expect(dismissed?.response).toBeUndefined();
  });

  it('keeps the request rather than deleting it, so the panel can show what happened', async () => {
    await store.add(request('r1'));
    await store.dismiss('r1');
    expect(store.get('r1')).toBeDefined();
    expect((await onDisk())).toHaveLength(1);
  });

  it('records a note when one was given', async () => {
    await store.add(request('r1'));
    const dismissed = await store.dismiss('r1', '  Not important right now.  ');
    expect(dismissed?.dismissalNote).toBe('Not important right now.');
  });

  it('leaves the note off when it is blank', async () => {
    await store.add(request('r1'));
    expect((await store.dismiss('r1', '   '))?.dismissalNote).toBeUndefined();
  });

  it('reports a request that is not there', async () => {
    expect(await store.dismiss('nope')).toBeUndefined();
  });
});

describe('list', () => {
  it('keeps what still needs an answer at the top', async () => {
    await store.add(request('r1', { status: 'answered', answeredAt: '2026-09-25T11:00:00.000Z' }));
    await store.add(request('r2'));
    await store.add(request('r3', { status: 'dismissed', dismissedAt: '2026-09-25T12:00:00.000Z' }));
    expect(store.list().map((r) => r.id)).toEqual(['r2', 'r3', 'r1']);
  });

  it('puts an urgent request above an older quiet one', async () => {
    await store.add(request('r1'));
    await store.add(request('r2', { urgency: 'high' }));
    expect(store.list().map((r) => r.id)).toEqual(['r2', 'r1']);
  });

  it('sorts answered and dismissed together, most recently settled first', async () => {
    await store.add(request('r1', { status: 'answered', answeredAt: '2026-09-25T11:00:00.000Z' }));
    await store.add(request('r2', { status: 'dismissed', dismissedAt: '2026-09-25T13:00:00.000Z' }));
    await store.add(request('r3', { status: 'answered', answeredAt: '2026-09-25T12:00:00.000Z' }));
    expect(store.list().map((r) => r.id)).toEqual(['r2', 'r3', 'r1']);
  });
});

describe('clearResolved', () => {
  it('drops answered and dismissed alike, keeping what is still open', async () => {
    await store.add(request('r1', { status: 'answered', answeredAt: '2026-09-25T11:00:00.000Z' }));
    await store.add(request('r2', { status: 'dismissed', dismissedAt: '2026-09-25T11:00:00.000Z' }));
    await store.add(request('r3'));
    await store.clearResolved();
    expect(store.list().map((r) => r.id)).toEqual(['r3']);
    expect(await onDisk()).toHaveLength(1);
  });
});

describe('persistence', () => {
  it('reads a dismissal back after a restart', async () => {
    await store.add(request('r1'));
    await store.dismiss('r1', 'Skip it.');

    const reopened = new HumanRequestStore(file);
    await reopened.load();
    expect(reopened.get('r1')).toMatchObject({ status: 'dismissed', dismissalNote: 'Skip it.' });
  });
});
