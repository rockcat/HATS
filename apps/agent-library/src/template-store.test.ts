// Creating a template under a given id — how an imported project keeps its
// agents' identities.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { TemplateStore } from './template-store.js';

let dir: string;
let store: TemplateStore;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'hats-templates-'));
  store = new TemplateStore(dir);
  await store.load();
});

afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const ID = 'c74e1785-45f6-4660-9711-223f130db6ce';

describe('upsert', () => {
  it('creates a missing template with the id it was given', async () => {
    const { template, created } = await store.upsert(ID, { name: 'Poppy' });
    expect(created).toBe(true);
    expect(template.id).toBe(ID);
    expect(store.get(ID)?.name).toBe('Poppy');
  });

  it('replaces one that exists, keeping its id', async () => {
    await store.upsert(ID, { name: 'Poppy' });
    const { template, created } = await store.upsert(ID, { name: 'Poppy Two' });
    expect(created).toBe(false);
    expect(template.id).toBe(ID);
    expect(template.revision).toBe(2);
  });

  it('survives a reload', async () => {
    await store.upsert(ID, { name: 'Poppy' });
    const again = new TemplateStore(dir);
    await again.load();
    expect(again.get(ID)?.name).toBe('Poppy');
  });
});
