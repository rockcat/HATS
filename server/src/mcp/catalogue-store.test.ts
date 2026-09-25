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

async function freshCatalogue(): Promise<void> {
  dir = await mkdtemp(path.join(tmpdir(), 'hats-cat-'));
  file = path.join(dir, 'mcp-catalogue.json');
  await writeFile(file, JSON.stringify([{
    id: CUSTOM, name: 'Custom', description: 'Hand-added.', category: 'productivity',
    users: ['human'], config: { transport: 'stdio', command: 'node', args: ['c.js'] },
  }]));
  await initCatalogue(file);
}

const entry = (id: string): MCPCatalogueEntry | undefined => getCatalogue().find((e) => e.id === id);
const onDisk = async (id: string) =>
  (JSON.parse(await readFile(file, 'utf-8')) as MCPCatalogueEntry[]).find((e) => e.id === id);

beforeEach(freshCatalogue);
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

describe('recordDiscoveredTools', () => {
  it('stores what a server offered, sorted, so the library can list it', async () => {
    await recordDiscoveredTools(BUILTIN, TOOLS);
    expect(entry(BUILTIN)?.knownTools?.map((t) => t.name)).toEqual(['create_label', 'get_email']);
    expect(entry(BUILTIN)?.toolsDiscoveredAt).toBeTypeOf('string');
  });

  it('writes through to the shared file, which is how the library sees it', async () => {
    await recordDiscoveredTools(BUILTIN, TOOLS);
    expect((await onDisk(BUILTIN))?.knownTools).toHaveLength(2);
  });

  it('survives a catalogue reload, which refreshes built-ins from code', async () => {
    // The tool list is observed, not declared — nothing could regenerate it.
    await recordDiscoveredTools(BUILTIN, TOOLS);
    await initCatalogue(file);
    expect(entry(BUILTIN)?.knownTools?.map((t) => t.name)).toEqual(['create_label', 'get_email']);
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

    await otherProcessWrites((entries) => {
      const e = entries.find((x) => x.id === BUILTIN);
      if (e) { e.knownTools = TOOLS; e.toolsDiscoveredAt = new Date().toISOString(); }
    });

    expect(entry(BUILTIN)?.knownTools).toHaveLength(2);
  });

  it('does not overwrite a tool list it never knew about', async () => {
    await otherProcessWrites((entries) => {
      const e = entries.find((x) => x.id === BUILTIN);
      if (e) e.knownTools = TOOLS;
    });

    // An unrelated edit here used to write out the stale snapshot whole.
    await updateEntry(CUSTOM, { description: 'Edited in the dashboard.' });

    expect((await onDisk(BUILTIN))?.knownTools).toHaveLength(2);
    expect((await onDisk(CUSTOM))?.description).toBe('Edited in the dashboard.');
  });

  it('does not overwrite an edit made while it was recording tools', async () => {
    await otherProcessWrites((entries) => {
      const e = entries.find((x) => x.id === CUSTOM);
      if (e) e.description = 'Renamed elsewhere.';
    });

    await recordDiscoveredTools(BUILTIN, TOOLS);

    expect((await onDisk(CUSTOM))?.description).toBe('Renamed elsewhere.');
    expect((await onDisk(BUILTIN))?.knownTools).toHaveLength(2);
  });

  it('keeps serving what it has when the file goes unreadable', async () => {
    await recordDiscoveredTools(BUILTIN, TOOLS);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await writeFile(file, 'not json at all');
    // Better a slightly old catalogue than none.
    expect(entry(BUILTIN)?.knownTools).toHaveLength(2);
  });
});
