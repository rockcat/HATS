import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import {
  PEOPLE_TOOL_NAMES, describeRecognition, handlePeopleCall, peopleTools,
  type PeopleToolsContext,
} from './tools.js';
import { PeopleStore } from './store.js';
import { normalise } from './matching.js';
import type { FaceEmbedder } from './embedder.js';

const MODEL = { model: 'mobilefacenet-v1', dimensions: 8 };

const facing = (axis: number, noise = 0) =>
  normalise(Array.from({ length: 8 }, (_, i) => (i === axis ? 1 : 0) + (i === (axis + 1) % 8 ? noise : 0)));

/** An embedder that returns whatever it is told to, without a model. */
class StubEmbedder implements FaceEmbedder {
  readonly model = MODEL;
  constructor(private readonly result: number[] | null) {}
  async embed(): Promise<number[] | null> { return this.result; }
}

const dirs: string[] = [];
let store: PeopleStore;
let context: PeopleToolsContext;

beforeEach(async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hats-people-tools-'));
  dirs.push(dir);
  store = new PeopleStore(path.join(dir, 'people.json'));
  context = { store, model: MODEL, config: {}, agentName: 'Poppy' };
});
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const call = (name: string, args: Record<string, unknown> = {}, ctx = context) =>
  handlePeopleCall(ctx, name, args);

describe('what the agent is offered', () => {
  it('offers the four tools', () => {
    expect(peopleTools(context).map((t) => t.name)).toEqual([
      'identify_person', 'remember_person', 'forget_person', 'list_people',
    ]);
  });

  it('offers them even on a runner with no model of its own', () => {
    // The runner names the space; a device that can embed does the work. An
    // agent offered nothing here cannot even list who it has met.
    expect(peopleTools({ ...context, embedder: null }).map((t) => t.name))
      .toHaveLength(4);
  });

  it('names every tool it offers in PEOPLE_TOOL_NAMES', () => {
    // The executor routes on that list, so a tool missing from it is offered
    // to the agent and then reported as unknown when called.
    expect([...PEOPLE_TOOL_NAMES].sort())
      .toEqual(peopleTools(context).map((t) => t.name).sort());
  });

  it('tells the agent not to guess a name', () => {
    // This description is all the model reads before deciding what to do.
    const identify = peopleTools(context).find((t) => t.name === 'identify_person');
    expect(identify?.description).toContain('worse than asking');
  });

  it('tells the agent to ask before remembering a face', () => {
    const remember = peopleTools(context).find((t) => t.name === 'remember_person');
    expect(remember?.description).toContain('Ask them first');
    expect(remember?.description).toContain('refuses without consent');
  });

  it('tells the agent to forget somebody without arguing', () => {
    const forget = peopleTools(context).find((t) => t.name === 'forget_person');
    expect(forget?.description).toContain('without');
  });
});

describe('putting a recognition into words', () => {
  const person = (name: string, over = {}) => ({
    id: name, name, templates: [], createdAt: '', consent: { granted: true, at: '' }, ...over,
  });

  it('names somebody it knows', () => {
    const text = describeRecognition({ outcome: 'known', person: person('Paul'), score: 0.91 });
    expect(text).toContain('This is Paul');
    expect(text).toContain('0.91');
  });

  it('mentions that somebody is the main user', () => {
    const text = describeRecognition({
      outcome: 'known', person: person('Paul', { primary: true }), score: 0.9,
    });
    expect(text).toContain('main user');
  });

  it('tells the agent to ask rather than pick, when unsure', () => {
    const text = describeRecognition({
      outcome: 'unsure',
      candidates: [
        { person: person('Paul'), score: 0.72 },
        { person: person('Rhoda'), score: 0.70 },
      ],
    });

    expect(text).toContain('Paul');
    expect(text).toContain('Rhoda');
    expect(text).toContain('rather than guessing');
  });

  it('distinguishes a stranger from an empty register', () => {
    // Different next moves: ask whether to remember them, versus just ask who
    // they are. An agent told the wrong one behaves oddly.
    expect(describeRecognition({ outcome: 'unknown' })).toContain('do not recognise');
    expect(describeRecognition({ outcome: 'no-templates' })).toContain('not been introduced');
  });
});

describe('identifying somebody', () => {
  it('recognises a face it was given', async () => {
    await call('remember_person', { name: 'Paul', consent: true, vector: facing(0) });
    expect(await call('identify_person', { vector: facing(0) })).toContain('This is Paul');
  });

  it('accepts a photo when the runner can embed', async () => {
    const withEmbedder = { ...context, embedder: new StubEmbedder(facing(0)) };
    await call('remember_person', { name: 'Paul', consent: true, vector: facing(0) }, withEmbedder);

    expect(await call('identify_person', { image_base64: 'abc' }, withEmbedder))
      .toContain('This is Paul');
  });

  it('says plainly when a photo arrives and nothing here can read it', async () => {
    const out = await call('identify_person', { image_base64: 'abc' }).catch((e: Error) => e.message);
    expect(out).toContain('no face model');
  });

  it('says so when there is no face in the picture', async () => {
    const blank = { ...context, embedder: new StubEmbedder(null) };
    await expect(call('identify_person', { image_base64: 'abc' }, blank))
      .rejects.toThrow(/no face in that picture/);
  });

  it('refuses a vector of the wrong size rather than storing nonsense', async () => {
    // It could never match anything, and nobody would be able to tell why.
    await expect(call('identify_person', { vector: [1, 2, 3] }))
      .rejects.toThrow(/cannot be compared/);
  });

  it('refuses a vector with values it cannot read', async () => {
    await expect(call('identify_person', { vector: Array(8).fill('x') }))
      .rejects.toThrow(/cannot read/);
  });

  it('says what is missing when nothing here can see', async () => {
    await expect(call('identify_person')).rejects.toThrow(/nothing here that can see a face/);
  });
});

describe('remembering somebody', () => {
  it('refuses without consent, whatever the agent intended', async () => {
    await expect(call('remember_person', { name: 'Paul', consent: false, vector: facing(0) }))
      .rejects.toThrow(/No consent recorded for Paul/);

    expect(await store.all()).toEqual([]);
  });

  it('refuses when consent is simply absent', async () => {
    await expect(call('remember_person', { name: 'Paul', vector: facing(0) }))
      .rejects.toThrow(/No consent/);
  });

  it('records which agent did the asking', async () => {
    await call('remember_person', { name: 'Paul', consent: true, vector: facing(0) });
    expect((await store.all())[0]?.consent.askedBy).toBe('Poppy');
  });

  it('asks for a name rather than storing a blank one', async () => {
    await expect(call('remember_person', { name: '   ', consent: true, vector: facing(0) }))
      .rejects.toThrow(/What is their name/);
  });

  it('adds another angle for somebody already known', async () => {
    await call('remember_person', { name: 'Paul', consent: true, vector: facing(0) });
    const out = await call('remember_person', { name: 'Paul', consent: true, vector: facing(0, 0.6) });

    expect(out).toContain('2 view(s)');
  });

  it('can mark the main user', async () => {
    const out = await call('remember_person', {
      name: 'Paul', consent: true, vector: facing(0), primary: true,
    });
    expect(out).toContain('main user');
  });

  it('keeps a note about them', async () => {
    await call('remember_person', {
      name: 'Paul', consent: true, vector: facing(0), notes: 'Prefers to be called Paul, not Mr Cox.',
    });
    expect(await call('list_people')).toContain('Prefers to be called Paul');
  });
});

describe('forgetting somebody', () => {
  it('removes them and says so plainly', async () => {
    await call('remember_person', { name: 'Paul', consent: true, vector: facing(0) });
    const out = await call('forget_person', { name: 'Paul' });

    expect(out).toContain('Forgotten Paul');
    expect(await store.all()).toEqual([]);
  });

  it('stops recognising them', async () => {
    await call('remember_person', { name: 'Paul', consent: true, vector: facing(0) });
    await call('forget_person', { name: 'Paul' });

    expect(await call('identify_person', { vector: facing(0) })).toContain('not been introduced');
  });

  it('says so when there is nobody of that name', async () => {
    expect(await call('forget_person', { name: 'Nobody' })).toContain('do not have anybody');
  });
});

describe('listing who is known', () => {
  it('says plainly when nobody is', async () => {
    expect(await call('list_people')).toContain('not been introduced to anybody');
  });

  it('never includes the face data', async () => {
    // A list of who the team knows should not hand out their biometrics.
    await call('remember_person', { name: 'Paul', consent: true, vector: facing(0) });
    const out = await call('list_people');

    expect(out).toContain('Paul');
    expect(out).not.toContain('0.7071');
    expect(out).not.toContain('vector');
  });
});

describe('a runner that cannot embed a picture itself', () => {
  it('says what to send instead, and names the model to send it in', async () => {
    // Thrown rather than returned: the agent has to know the call did not
    // happen, not read a sentence and assume it did.
    await expect(call('identify_person', { image_base64: 'c29tZXRoaW5n' },
      { ...context, embedder: null }))
      .rejects.toThrow(new RegExp(`${MODEL.model}.*${MODEL.dimensions}d`));
  });

  it('still works from a vector the device produced', async () => {
    // The whole point of naming a model without running one.
    expect(await call('identify_person', { vector: facing(0) }, { ...context, embedder: null }))
      .toBeTruthy();
  });
});

describe('an unknown tool', () => {
  it('says which one', async () => {
    await expect(call('make_tea')).rejects.toThrow(/Unknown tool: make_tea/);
  });
});


// ── Letting the device do the looking ────────────────────────────────────────
//
// The path that matters in practice: the phone or the browser tab runs the
// model, so the face never leaves it and the agent never handles the numbers.

describe('asking the device to look', () => {
  const withDevice = (answer: unknown) => ({
    ...context,
    askDevice: async () => answer as never,
  });

  it('identifies with no arguments at all', async () => {
    // The agent should not have to know a vector exists.
    const ctx = withDevice({ ok: true, data: facing(0) });
    await call('remember_person', { name: 'Paul', consent: true, vector: facing(0) });
    expect(await call('identify_person', {}, ctx)).toContain('Paul');
  });

  it('remembers somebody from the camera, given just a name', async () => {
    const ctx = withDevice({ ok: true, data: facing(0) });
    expect(await call('remember_person', { name: 'Paul', consent: true }, ctx)).toContain('Paul');
    expect(await call('identify_person', {}, ctx)).toContain('Paul');
  });

  it('prefers a vector it was handed over asking the device', async () => {
    let asked = false;
    const ctx = {
      ...context,
      askDevice: async () => { asked = true; return { ok: true, data: facing(0) } as never; },
    };
    await call('identify_person', { vector: facing(1) }, ctx);
    expect(asked).toBe(false);
  });

  it(`passes the device's own complaint through`, async () => {
    // "I cannot see a face" is something the agent can act on by asking the
    // user to move; a generic failure is not.
    const ctx = withDevice({ ok: false, error: 'I cannot see a face.' });
    await expect(call('identify_person', {}, ctx)).rejects.toThrow(/cannot see a face/);
  });

  it('falls back to its own words when the device sends an empty vector', async () => {
    const ctx = withDevice({ ok: true, data: [] });
    await expect(call('identify_person', {}, ctx)).rejects.toThrow(/nothing here that can see/);
  });

  it('refuses a vector of the wrong size from a device', async () => {
    // A device running a different model would otherwise file templates that
    // can never match anything, and nobody could tell why.
    const ctx = withDevice({ ok: true, data: new Array(512).fill(0.1) });
    await expect(call('identify_person', {}, ctx)).rejects.toThrow(/cannot be compared/);
  });
});
