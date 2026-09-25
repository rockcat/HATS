import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { getCatalogue, initCatalogue, recordDiscoveredTools, updateEntry } from './catalogue-store.js';
import type { MCPCatalogueEntry } from './mcp-catalogue.js';

/** A built-in id, so the refresh-from-code path is the one under test. */
const BUILTIN = 'email-imap';
const CUSTOM = 'test-custom-server';

const TOOLS = [
  { name: 'get_email', description: 'Get the full content of an email by ID.' },
  { name: 'create_label', description: 'Create a mailbox label.' },
];

let dir = '';
let file = '';
let toolsFile = '';

async function freshCatalogue(): Promise<void> {
  dir = await mkdtemp(path.join(tmpdir(), 'hats-cat-'));
  file = path.join(dir, 'mcp-catalogue.json');
  toolsFile = path.join(dir, 'mcp-discovered-tools.json');
  await writeFile(file, JSON.stringify([{
    id: CUSTOM, name: 'Custom', description: 'Hand-added.', category: 'productivity',
    users: ['human'], config: { transport: 'stdio', command: 'node', args: ['c.js'] },
  }]));
  await initCatalogue(file);
}

const entry = (id: string): MCPCatalogueEntry | undefined => getCatalogue().find((e) => e.id === id);
const onDisk = async (id: string) =>
  (JSON.parse(await readFile(file, 'utf-8')) as MCPCatalogueEntry[]).find((e) => e.id === id);

/** The sidecar, which is where an observation is actually stored. */
const sidecar = async (): Promise<Record<string, { tools: unknown[]; at: string }>> => {
  try {
    return JSON.parse(await readFile(toolsFile, 'utf-8'));
  } catch {
    return {};
  }
};

beforeEach(freshCatalogue);
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

describe('recordDiscoveredTools', () => {
  it('stores what a server offered, sorted, so the library can list it', async () => {
    await recordDiscoveredTools(BUILTIN, TOOLS);
    expect(entry(BUILTIN)?.knownTools?.map((t) => t.name)).toEqual(['create_label', 'get_email']);
    expect(entry(BUILTIN)?.toolsDiscoveredAt).toBeTypeOf('string');
  });

  it('writes to the sidecar, not into the tracked catalogue', async () => {
    await recordDiscoveredTools(BUILTIN, TOOLS);
    // An observation of one machine has no business in checked-in config:
    // it produced a diff on every runner start.
    expect((await sidecar())[BUILTIN]?.tools).toHaveLength(2);
    expect((await onDisk(BUILTIN))?.knownTools).toBeUndefined();
  });

  it('still reports it through getCatalogue, which is how the library reads it', async () => {
    await recordDiscoveredTools(BUILTIN, TOOLS);
    expect(entry(BUILTIN)?.knownTools).toHaveLength(2);
  });

  it('survives a catalogue reload, which refreshes built-ins from code', async () => {
    // The tool list is observed, not declared — nothing could regenerate it.
    await recordDiscoveredTools(BUILTIN, TOOLS);
    await initCatalogue(file);
    expect(entry(BUILTIN)?.knownTools?.map((t) => t.name)).toEqual(['create_label', 'get_email']);
  });

  it('keeps the catalogue itself free of observations', async () => {
    await recordDiscoveredTools(BUILTIN, TOOLS);
    await initCatalogue(file);
    const written = JSON.parse(await readFile(file, 'utf-8')) as MCPCatalogueEntry[];
    expect(written.every((e) => e.knownTools === undefined)).toBe(true);
  });

  it('keeps the built-in definition authoritative apart from the tool list', async () => {
    await recordDiscoveredTools(BUILTIN, TOOLS);
    await initCatalogue(file);
    // The config still comes from code, so a change there reaches every machine.
    expect((entry(BUILTIN)?.config as { command?: string }).command).toBe('npx');
  });

  it('records against a hand-added entry too', async () => {
    await recordDiscoveredTools(CUSTOM, TOOLS);
    expect(entry(CUSTOM)?.knownTools).toHaveLength(2);
  });

  it('does not rewrite the file when nothing changed', async () => {
    await recordDiscoveredTools(BUILTIN, TOOLS);
    const first = entry(BUILTIN)?.toolsDiscoveredAt;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await recordDiscoveredTools(BUILTIN, [...TOOLS].reverse());
    expect(entry(BUILTIN)?.toolsDiscoveredAt).toBe(first);
  });

  it('refreshes when the server starts offering something new', async () => {
    await recordDiscoveredTools(BUILTIN, TOOLS);
    await recordDiscoveredTools(BUILTIN, [...TOOLS, { name: 'send_email', description: 'Send one.' }]);
    expect(entry(BUILTIN)?.knownTools).toHaveLength(3);
  });

  it('ignores an empty list rather than forgetting what it knew', async () => {
    // A server that fails to start reports nothing; that is not news.
    await recordDiscoveredTools(BUILTIN, TOOLS);
    await recordDiscoveredTools(BUILTIN, []);
    expect(entry(BUILTIN)?.knownTools).toHaveLength(2);
  });

  it('ignores a server that is not in the catalogue', async () => {
    await expect(recordDiscoveredTools('nonsense', TOOLS)).resolves.toBeUndefined();
  });
});

describe('sharing the file with another process', () => {
  // The runner writes tool lists; the library and Project Server read them and
  // the dashboard edits entries. Each holds its own copy, so a snapshot taken
  // at startup goes stale and a blind write-back destroys the other's work.

  /** Write the file behind this process's back, as another process would. */
  const otherProcessWrites = async (mutate: (entries: MCPCatalogueEntry[]) => void) => {
    const entries = JSON.parse(await readFile(file, 'utf-8')) as MCPCatalogueEntry[];
    mutate(entries);
    // Nudge past mtime granularity so the change is unambiguous.
    await new Promise((resolve) => setTimeout(resolve, 10));
    await writeFile(file, JSON.stringify(entries, null, 2));
  };

  it('picks up a tool list recorded after this process started', async () => {
    // What the Agent Library saw: the runner recorded 49 tools and the library
    // went on reporting none until it was restarted.
    expect(entry(BUILTIN)?.knownTools).toBeUndefined();

    await new Promise((resolve) => setTimeout(resolve, 10));
    await writeFile(toolsFile, JSON.stringify({
      [BUILTIN]: { tools: TOOLS, at: new Date().toISOString() },
    }));

    expect(entry(BUILTIN)?.knownTools).toHaveLength(2);
  });

  it('picks up a tool list another process discovered', async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    await writeFile(toolsFile, JSON.stringify({
      [BUILTIN]: { tools: TOOLS, at: new Date().toISOString() },
    }));
    expect(entry(BUILTIN)?.knownTools).toHaveLength(2);
  });

  it('does not overwrite an edit made while it was recording tools', async () => {
    await otherProcessWrites((entries) => {
      const e = entries.find((x) => x.id === CUSTOM);
      if (e) e.description = 'Renamed elsewhere.';
    });

    await recordDiscoveredTools(BUILTIN, TOOLS);

    expect((await onDisk(CUSTOM))?.description).toBe('Renamed elsewhere.');
    expect((await sidecar())[BUILTIN]?.tools).toHaveLength(2);
  });

  it('lifts observations an older build left in the catalogue, once', async () => {
    // The tracked file arrives with knownTools in it; after a load it should
    // be clean and the sidecar should hold them.
    const scratch = await mkdtemp(path.join(tmpdir(), 'hats-lift-'));
    const cat = path.join(scratch, 'mcp-catalogue.json');
    await writeFile(cat, JSON.stringify([{
      id: CUSTOM, name: 'Custom', description: 'Hand-added.', category: 'productivity',
      users: ['human'], config: { transport: 'stdio', command: 'node', args: ['c.js'] },
      knownTools: TOOLS, toolsDiscoveredAt: '2026-09-01T00:00:00.000Z',
    }]));

    await initCatalogue(cat);

    const written = JSON.parse(await readFile(cat, 'utf-8')) as MCPCatalogueEntry[];
    expect(written.find((e) => e.id === CUSTOM)?.knownTools).toBeUndefined();
    expect(entry(CUSTOM)?.knownTools).toHaveLength(2);
    await rm(scratch, { recursive: true, force: true });
  });

  it('keeps serving what it has when the file goes unreadable', async () => {
    await recordDiscoveredTools(BUILTIN, TOOLS);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await writeFile(file, 'not json at all');
    // Better a slightly old catalogue than none.
    expect(entry(BUILTIN)?.knownTools).toHaveLength(2);
  });
});
