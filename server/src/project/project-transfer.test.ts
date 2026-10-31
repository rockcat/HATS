// Moving a project from one machine to another through a single zip.
//
// Each "machine" here is a data directory plus in-memory stand-ins for its
// Project Server, Agent Library, credentials and scheduled actions.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { strToU8, zipSync } from 'fflate';
import type { AgentTemplate, DeployedAgent, ProjectDefinition } from '../../../packages/contracts/src/types.js';
import type { AgentSecrets } from '../api/agent-store.js';
import type { ScheduledActionDef } from '../store/team-snapshot.js';
import { closeAllProjectDbs, openProjectDb } from '../store/project-db.js';
import { ArchiveError, isSafeRelativePath, unpackArchive } from './project-archive.js';
import {
  exportProject, importProject, TransferConflict, TransferNotFound, type TransferDeps,
} from './project-transfer.js';

const POPPY = 'c74e1785-45f6-4660-9711-223f130db6ce';
const ACTION = '56aab551-0000-0000-0000-000000000000';
const GONE = 'c960d2a1-0000-0000-0000-000000000000';
const PASSWORD = 'correct-horse-battery';

interface Machine {
  root: string;
  deps: TransferDeps;
  projects: Map<string, ProjectDefinition>;
  templates: Map<string, AgentTemplate>;
  secrets: Map<string, AgentSecrets>;
  actions: Map<string, ScheduledActionDef>;
}

let dirs: string[] = [];

async function machine(): Promise<Machine> {
  const root = await mkdtemp(path.join(tmpdir(), 'hats-transfer-'));
  dirs.push(root);
  const projects = new Map<string, ProjectDefinition>();
  const templates = new Map<string, AgentTemplate>();
  const secrets = new Map<string, AgentSecrets>();
  const actions = new Map<string, ScheduledActionDef>();
  const deps: TransferDeps = {
    projectsRoot: path.join(root, 'projects'),
    dataRoot: root,
    projectServer: {
      getProject: async (id) => projects.get(id),
      createProject: async (input) => {
        const def = { ...input, id: input.id!, team: input.team ?? [] } as ProjectDefinition;
        projects.set(def.id, def);
        return def;
      },
    },
    library: {
      getTemplate: async (id) => templates.get(id),
      putTemplate: async (id, input) => {
        const t = { ...input, id, revision: 1 } as AgentTemplate;
        templates.set(id, t);
        return t;
      },
    },
    secrets: {
      get: (id) => secrets.get(id) ?? {},
      set: async (id, s) => { secrets.set(id, s); },
    },
    actions: {
      get: (id) => actions.get(id),
      addIfMissing: async (def) => {
        if (actions.has(def.id)) return false;
        actions.set(def.id, def);
        return true;
      },
    },
  };
  return { root, deps, projects, templates, secrets, actions };
}

const identity = { visualDescription: 'Calm', avatar: 'max.glb', background: 'office.png', voice: 'en_GB-semaine-medium' };

/** The source machine: a project "paige" with Poppy on it, as on the real one. */
async function seed(m: Machine): Promise<void> {
  const poppy = {
    instanceId: POPPY, templateId: POPPY, name: 'Poppy', hats: ['white'], identity,
    model: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
    scheduledActionIds: [ACTION, GONE], enabled: true, deployedAt: '2026-08-29T11:57:43.006Z',
  } as unknown as DeployedAgent;
  m.projects.set('paige', { id: 'paige', name: 'paige', goal: 'Personal Assistant', team: [poppy] } as ProjectDefinition);
  m.templates.set(POPPY, {
    schemaVersion: 1, id: POPPY, name: 'Poppy', hats: ['white'], identity,
    model: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
    revision: 4, createdAt: 'then', updatedAt: 'now',
  } as unknown as AgentTemplate);
  m.secrets.set(POPPY, {
    teamContext: 'Paul’s assistant',
    personalMcpCredentials: { 'email-imap': { MCP_EMAIL_PASSWORD: PASSWORD } },
  });
  m.actions.set(ACTION, { id: ACTION, label: 'Check mail', description: 'd', intervalSeconds: 600, createdAt: 'x' });

  const dir = path.join(m.deps.projectsRoot, 'paige');
  await mkdir(path.join(dir, 'tkt-011'), { recursive: true });
  await writeFile(path.join(dir, 'team-state.json'), '{"agentThreads":{}}');
  await writeFile(path.join(dir, 'tkt-011', 'notes.md'), 'Xmas Randomiser');
  // Left open, as a running project's is: the row is in the WAL, not yet in project.db.
  const db = openProjectDb(path.join(dir, 'project.db'));
  db.exec('CREATE TABLE IF NOT EXISTS events (body TEXT)');
  db.prepare('INSERT INTO events VALUES (?)').run('invitations sent');

  await mkdir(path.join(m.root, 'avatars', 'backgrounds'), { recursive: true });
  await writeFile(path.join(m.root, 'avatars', 'max.glb'), 'glb bytes');
  // office.png is deliberately absent.
}

beforeEach(() => { dirs = []; });
afterEach(async () => {
  closeAllProjectDbs();
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

async function moved(options: { includeCredentials: boolean }) {
  const from = await machine();
  await seed(from);
  const { bytes, manifest } = await exportProject(from.deps, 'paige', options);
  const to = await machine();
  const report = await importProject(to.deps, bytes);
  return { from, to, bytes, manifest, report };
}

describe('a project moved to another machine', () => {
  it('brings its folder, including subfolders', async () => {
    const { to } = await moved({ includeCredentials: false });
    const dir = path.join(to.deps.projectsRoot, 'paige');
    expect(await readFile(path.join(dir, 'team-state.json'), 'utf8')).toBe('{"agentThreads":{}}');
    expect(await readFile(path.join(dir, 'tkt-011', 'notes.md'), 'utf8')).toBe('Xmas Randomiser');
  });

  it('brings the database whole, including what was still in the WAL', async () => {
    const { to } = await moved({ includeCredentials: false });
    const dir = path.join(to.deps.projectsRoot, 'paige');
    expect(existsSync(path.join(dir, 'project.db-wal'))).toBe(false);
    const db = openProjectDb(path.join(dir, 'project.db'));
    expect(db.prepare('SELECT body FROM events').all()).toEqual([{ body: 'invitations sent' }]);
  });

  it('registers the project with its team', async () => {
    const { to } = await moved({ includeCredentials: false });
    expect(to.projects.get('paige')?.team.map((a) => a.instanceId)).toEqual([POPPY]);
  });

  it('brings the agent template under the same id', async () => {
    const { to, report } = await moved({ includeCredentials: false });
    expect(to.templates.get(POPPY)?.name).toBe('Poppy');
    expect(report.templates.created).toEqual(['Poppy']);
  });

  it('brings scheduled actions under the same ids', async () => {
    const { to, report } = await moved({ includeCredentials: false });
    expect(to.actions.get(ACTION)?.label).toBe('Check mail');
    expect(report.scheduledActions).toEqual({ added: 1, kept: 0 });
  });

  it('brings the avatar, and says what it could not bring', async () => {
    const { to, report } = await moved({ includeCredentials: false });
    expect(await readFile(path.join(to.root, 'avatars', 'max.glb'), 'utf8')).toBe('glb bytes');
    expect(report.warnings.join('\n')).toContain('avatars/backgrounds/office.png');
    expect(report.warnings.join('\n')).toContain(GONE);
    expect(report.missingVoices).toEqual(['en_GB-semaine-medium']);
  });
});

describe('credentials', () => {
  it('are left out unless asked for', async () => {
    const { to, bytes } = await moved({ includeCredentials: false });
    expect(to.secrets.get(POPPY)).toEqual({ teamContext: 'Paul’s assistant' });
    const archive = await unpackArchive(bytes);
    expect(JSON.stringify(archive.secrets)).not.toContain(PASSWORD);
  });

  it('travel when asked for', async () => {
    const { to } = await moved({ includeCredentials: true });
    expect(to.secrets.get(POPPY)?.personalMcpCredentials?.['email-imap']?.['MCP_EMAIL_PASSWORD']).toBe(PASSWORD);
  });

  it('already on the new machine are not overwritten', async () => {
    const from = await machine();
    await seed(from);
    const { bytes } = await exportProject(from.deps, 'paige', { includeCredentials: true });
    const to = await machine();
    to.secrets.set(POPPY, { personalMcpCredentials: { 'email-imap': { MCP_EMAIL_PASSWORD: 'newer' } } });

    await importProject(to.deps, bytes);
    expect(to.secrets.get(POPPY)?.personalMcpCredentials?.['email-imap']?.['MCP_EMAIL_PASSWORD']).toBe('newer');
    expect(to.secrets.get(POPPY)?.teamContext).toBe('Paul’s assistant');
  });
  // As saved before credentials moved out of the project: a copy added from
  // the dashboard, its password in team-state.json, and a key in each server.
  const COPY = 'd2b1a0c4-0000-0000-0000-000000000000';
  const COPY_PASSWORD = 'copy-only-password';
  const BRAVE = 'brave-key-from-env';
  async function olderSave(m: Machine): Promise<void> {
    process.env['BRAVE_API_KEY'] = BRAVE;
    const brave = { name: 'brave-search', config: { transport: 'stdio', command: 'npx', env: { BRAVE_API_KEY: BRAVE } } };
    m.projects.get('paige')!.mcpServers = [brave] as ProjectDefinition['mcpServers'];
    await writeFile(path.join(m.deps.projectsRoot, 'paige', 'team-state.json'), JSON.stringify({
      version: 2, agentIds: [COPY],
      agents: { [COPY]: { id: COPY, templateId: POPPY, identity: { name: 'Pip', ...identity },
        personalMcpCredentials: { 'email-imap': { MCP_EMAIL_PASSWORD: COPY_PASSWORD } } } },
      mcpServers: [brave],
    }));
  }
  async function everything(bytes: Uint8Array): Promise<string> {
    const archive = await unpackArchive(bytes);
    const files = [...archive.projectFiles.values()].map((d) => new TextDecoder().decode(d));
    return JSON.stringify(archive) + files.join('');
  }

  it('saved in the project by an older runner do not travel unless asked for', async () => {
    const from = await machine();
    await seed(from);
    await olderSave(from);
    const { bytes } = await exportProject(from.deps, 'paige', { includeCredentials: false });
    const all = await everything(bytes);
    expect(all).not.toContain(COPY_PASSWORD);
    expect(all).not.toContain(BRAVE);
  });

  it('of an agent added from the dashboard travel when asked for, outside the project', async () => {
    const from = await machine();
    await seed(from);
    await olderSave(from);
    const { bytes } = await exportProject(from.deps, 'paige', { includeCredentials: true });
    const to = await machine();
    await importProject(to.deps, bytes);
    expect(to.secrets.get(COPY)?.personalMcpCredentials?.['email-imap']?.['MCP_EMAIL_PASSWORD']).toBe(COPY_PASSWORD);
    const state = await readFile(path.join(to.deps.projectsRoot, 'paige', 'team-state.json'), 'utf8');
    expect(state).not.toContain(COPY_PASSWORD);
  });
});

describe('what is already there', () => {
  it('a project with the same id is refused, and nothing is written', async () => {
    const from = await machine();
    await seed(from);
    const { bytes } = await exportProject(from.deps, 'paige', { includeCredentials: false });

    await expect(importProject(from.deps, bytes)).rejects.toThrow(TransferConflict);
  });

  it('it can be imported under another id instead', async () => {
    const from = await machine();
    await seed(from);
    const { bytes } = await exportProject(from.deps, 'paige', { includeCredentials: false });

    const report = await importProject(from.deps, bytes, { as: 'paige-copy' });
    expect(report.projectId).toBe('paige-copy');
    expect(from.projects.get('paige-copy')?.name).toBe('paige-copy');
    // The same agents, already in this library, are kept rather than replaced.
    expect(report.templates).toEqual({ created: [], kept: ['Poppy'] });
    expect(existsSync(path.join(from.deps.projectsRoot, 'paige-copy', 'tkt-011', 'notes.md'))).toBe(true);
  });

  it('the project folder is removed again if the Project Server refuses it', async () => {
    const from = await machine();
    await seed(from);
    const { bytes } = await exportProject(from.deps, 'paige', { includeCredentials: false });
    const to = await machine();
    to.deps.projectServer.createProject = async () => { throw new Error('refused'); };

    await expect(importProject(to.deps, bytes)).rejects.toThrow('refused');
    expect(existsSync(path.join(to.deps.projectsRoot, 'paige'))).toBe(false);
  });
});

describe('the archive', () => {
  it('names a project that does not exist', async () => {
    const m = await machine();
    await expect(exportProject(m.deps, 'nope', { includeCredentials: false })).rejects.toThrow(TransferNotFound);
  });

  it('is readable as plain JSON and files', async () => {
    const { bytes } = await moved({ includeCredentials: false });
    const archive = await unpackArchive(bytes);
    expect(archive.manifest.agents).toEqual([{ id: POPPY, name: 'Poppy' }]);
    expect([...archive.projectFiles.keys()].sort()).toEqual(['project.db', 'team-state.json', 'tkt-011/notes.md']);
  });

  it('is refused if it is not an export', async () => {
    const zip = zipSync({ 'readme.txt': strToU8('hello') });
    await expect(unpackArchive(zip)).rejects.toThrow(ArchiveError);
  });

  it('is refused if a path would escape the project folder', async () => {
    const zip = zipSync({
      'manifest.json': strToU8(JSON.stringify({ format: 'hats-project', version: 1, voices: [], warnings: [] })),
      'definition.json': strToU8('{}'),
      'project/../../escape.txt': strToU8('x'),
    });
    await expect(unpackArchive(zip)).rejects.toThrow(/unsafe path/);
  });
});

describe('isSafeRelativePath', () => {
  it.each(['a.json', 'tkt-011/notes.md'])('accepts %s', (p) => expect(isSafeRelativePath(p)).toBe(true));
  it.each(['', '/etc/passwd', '../x', 'a/../../x', 'a\\b', 'C:/x', 'a//b', './a'])(
    'refuses %s', (p) => expect(isSafeRelativePath(p)).toBe(false));
});
