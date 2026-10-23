import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { initCatalogue } from '@hats/core/mcp/catalogue-store';
import { resolveServerIds, sharedCatalogue } from './mcp.js';

let dir = '';

// Ids that are not built-in, so the catalogue keeps these definitions verbatim
// — built-in entries are refreshed from code on every load.
const TEAM = 'test-team-server';
const PERSONAL = 'test-personal-server';

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'hats-mcp-'));
  const file = path.join(dir, 'mcp-catalogue.json');
  await writeFile(file, JSON.stringify([
    {
      id: TEAM, name: 'Team Server', description: 'Shared with everyone.', category: 'productivity',
      users: ['human'],
      config: { transport: 'stdio', command: 'node', args: ['team.js'] },
    },
    {
      id: PERSONAL, name: 'Personal Server', description: "One agent's own account.", category: 'productivity',
      users: ['agent'],
      config: { transport: 'stdio', command: 'npx', args: ['-y', 'personal'] },
    },
  ]));
  await initCatalogue(file);
});

afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

describe('sharedCatalogue', () => {
  it('offers the team servers and withholds the per-agent ones', () => {
    const ids = sharedCatalogue().map((e) => e.id);
    expect(ids).toContain(TEAM);
    // A personal server carries one agent's credentials and has no business in
    // a project definition that gets shared around.
    expect(ids).not.toContain(PERSONAL);
  });

  it('includes the built-in shared servers', () => {
    expect(sharedCatalogue().map((e) => e.id)).toContain('kanban');
  });
});

describe('resolveServerIds', () => {
  it('expands an id into the definition a project stores', () => {
    expect(resolveServerIds([TEAM]).servers).toEqual([{
      name: TEAM,
      config: { transport: 'stdio', command: 'node', args: ['team.js'] },
    }]);
  });

  it('names the server after the catalogue id, which is what an agent refers to', () => {
    // enabledMcpServers on a deployed agent holds catalogue ids, so the stored
    // name has to match or the agent silently gets no tools.
    expect(resolveServerIds(['kanban']).servers[0]?.name).toBe('kanban');
  });

  it('reports an id that is not a shared server rather than storing it', () => {
    const { servers, unknown } = resolveServerIds([TEAM, PERSONAL, 'nonsense']);
    expect(servers.map((s) => s.name)).toEqual([TEAM]);
    expect(unknown).toEqual([PERSONAL, 'nonsense']);
  });

  it('ignores a repeated id', () => {
    expect(resolveServerIds([TEAM, TEAM]).servers).toHaveLength(1);
  });

  it('copies the config rather than handing out the catalogue entry', () => {
    const { servers } = resolveServerIds([TEAM]);
    (servers[0] as { config: { command: string } }).config.command = 'tampered';
    expect(resolveServerIds([TEAM]).servers[0]?.config.command).toBe('node');
  });

  it('turns an empty selection into an empty team', () => {
    expect(resolveServerIds([])).toEqual({ servers: [], unknown: [] });
  });
});
