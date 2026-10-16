import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { ConsentRequired, PeopleStore, withoutTemplates } from './store.js';
import { normalise } from './matching.js';
import type { Consent } from './types.js';

const MODEL = 'mobilefacenet-v1';
const YES: Consent = { granted: true, at: '2026-10-16T09:00:00.000Z', askedBy: 'Poppy' };
const NO: Consent = { granted: false, at: '2026-10-16T09:00:00.000Z', askedBy: 'Poppy' };

const facing = (axis: number, noise = 0, length = 8) =>
  normalise(Array.from({ length }, (_, i) => (i === axis ? 1 : 0) + (i === (axis + 1) % length ? noise : 0)));

const dirs: string[] = [];
const storeIn = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hats-people-'));
  dirs.push(dir);
  return new PeopleStore(path.join(dir, 'people.json'));
};
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('an empty register', () => {
  it('is empty rather than an error on the first run', async () => {
    expect(await (await storeIn()).all()).toEqual([]);
  });

  it('knows nobody', async () => {
    const store = await storeIn();
    expect(await store.identify(facing(0), MODEL)).toEqual({ outcome: 'no-templates' });
  });
});

describe('consent', () => {
  it('refuses to remember a face without it', async () => {
    // The point of asking is that "no" has an effect.
    const store = await storeIn();
    await expect(store.remember('Paul', facing(0), MODEL, NO)).rejects.toThrow(ConsentRequired);
  });

  it('stores nothing at all when refused, not a flagged record', async () => {
    // A consent flag on a stored template is a record of consent, not consent.
    const store = await storeIn();
    await store.remember('Paul', facing(0), MODEL, NO).catch(() => {});

    expect(await store.all()).toEqual([]);
  });

  it('records who asked and when', async () => {
    const store = await storeIn();
    const paul = await store.remember('Paul', facing(0), MODEL, YES);

    expect(paul.consent.askedBy).toBe('Poppy');
    expect(paul.consent.at).toBe('2026-10-16T09:00:00.000Z');
  });
});

describe('remembering somebody', () => {
  it('recognises them afterwards', async () => {
    const store = await storeIn();
    await store.remember('Paul', facing(0), MODEL, YES);

    const seen = await store.identify(facing(0), MODEL);
    expect(seen.outcome).toBe('known');
    if (seen.outcome === 'known') expect(seen.person.name).toBe('Paul');
  });

  it('survives a reload', async () => {
    const store = await storeIn();
    await store.remember('Paul', facing(0), MODEL, YES);

    const reopened = new PeopleStore(store.path);
    expect((await reopened.all())[0]?.name).toBe('Paul');
  });

  it('adds a new angle to somebody already known', async () => {
    const store = await storeIn();
    await store.remember('Paul', facing(0), MODEL, YES);
    await store.remember('Paul', facing(0, 0.6), MODEL, YES);

    const all = await store.all();
    expect(all).toHaveLength(1);
    expect(all[0]?.templates).toHaveLength(2);
  });

  it('does not store a near-duplicate', async () => {
    // It teaches nothing and slows every later comparison.
    const store = await storeIn();
    await store.remember('Paul', facing(0), MODEL, YES);
    await store.remember('Paul', facing(0), MODEL, YES);

    expect((await store.all())[0]?.templates).toHaveLength(1);
  });

  it('does not attach a completely different face to an existing name', async () => {
    // Almost certainly a mis-enrolment; storing it poisons both identities.
    const store = await storeIn();
    await store.remember('Paul', facing(0), MODEL, YES);
    await store.remember('Paul', facing(5), MODEL, YES);

    expect((await store.all())[0]?.templates).toHaveLength(1);
  });

  it('matches a name whatever its case', async () => {
    const store = await storeIn();
    await store.remember('Paul', facing(0), MODEL, YES);
    await store.remember('  paul  ', facing(0, 0.6), MODEL, YES);

    expect(await store.all()).toHaveLength(1);
  });

  it('normalises what it stores, so comparison stays a dot product', async () => {
    const store = await storeIn();
    await store.remember('Paul', [3, 4, 0, 0, 0, 0, 0, 0], MODEL, YES);

    const stored = (await store.all())[0]!.templates[0]!.vector;
    expect(Math.hypot(...stored)).toBeCloseTo(1, 10);
  });

  it('records when they were last seen', async () => {
    const store = await storeIn();
    await store.remember('Paul', facing(0), MODEL, YES);
    const before = (await store.all())[0]!.lastSeenAt;

    await new Promise((r) => setTimeout(r, 5));
    await store.identify(facing(0), MODEL);

    expect((await store.all())[0]!.lastSeenAt).not.toBe(before);
  });
});

describe('the main user', () => {
  it('can be named when they are remembered', async () => {
    const store = await storeIn();
    const paul = await store.remember('Paul', facing(0), MODEL, YES, { primary: true });
    expect(paul.primary).toBe(true);
  });

  it('is only ever one person', async () => {
    // Naming a new one stands the old one down, rather than having two.
    const store = await storeIn();
    await store.remember('Paul', facing(0), MODEL, YES, { primary: true });
    await store.remember('Rhoda', facing(4), MODEL, YES, { primary: true });

    const primaries = (await store.all()).filter((p) => p.primary);
    expect(primaries.map((p) => p.name)).toEqual(['Rhoda']);
  });

  it('can be found', async () => {
    const store = await storeIn();
    await store.remember('Paul', facing(0), MODEL, YES, { primary: true });
    expect((await store.primary())?.name).toBe('Paul');
  });

  it('can be set later, by id', async () => {
    const store = await storeIn();
    const paul = await store.remember('Paul', facing(0), MODEL, YES);
    await store.setPrimary(paul.id);

    expect((await store.primary())?.name).toBe('Paul');
  });
});

describe('forgetting somebody', () => {
  it('removes them, rather than flagging them', async () => {
    // A right to be forgotten that leaves the face behind is not one, and a
    // "deleted" template still matches.
    const store = await storeIn();
    await store.remember('Paul', facing(0), MODEL, YES);

    expect((await store.forget('Paul'))?.name).toBe('Paul');
    expect(await store.all()).toEqual([]);

    const text = await readFile(store.path, 'utf8');
    expect(text).not.toContain('Paul');
  });

  it('stops recognising them immediately', async () => {
    const store = await storeIn();
    await store.remember('Paul', facing(0), MODEL, YES);
    await store.forget('Paul');

    expect((await store.identify(facing(0), MODEL)).outcome).toBe('no-templates');
  });

  it('works by id as well as by name', async () => {
    const store = await storeIn();
    const paul = await store.remember('Paul', facing(0), MODEL, YES);
    expect((await store.forget(paul.id))?.name).toBe('Paul');
  });

  it('says so when there is nobody of that name', async () => {
    expect(await (await storeIn()).forget('Nobody')).toBeNull();
  });

  it('can drop every template from one model', async () => {
    // For when the embedding model changes and the old vectors are meaningless.
    const store = await storeIn();
    await store.remember('Paul', facing(0), MODEL, YES);
    await store.remember('Rhoda', facing(4), MODEL, YES);

    expect(await store.forgetModel(MODEL)).toBe(2);
    expect(await store.all()).toHaveLength(2);
    expect((await store.identify(facing(0), MODEL)).outcome).toBe('no-templates');
  });
});

describe('showing who is on file', () => {
  it('leaves the biometrics out', async () => {
    // A list of who the team knows should not hand out their face vectors.
    const store = await storeIn();
    const paul = await store.remember('Paul', facing(0), MODEL, YES);
    const shown = withoutTemplates(paul) as Record<string, unknown>;

    expect(shown['templates']).toBeUndefined();
    expect(shown['faces']).toBe(1);
    expect(shown['name']).toBe('Paul');
  });
});
