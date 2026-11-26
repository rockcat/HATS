import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import type { IAgent } from '../agent/iagent.js';
import type { AgentConfig } from '../agent/types.js';
import type { AIProvider } from '../providers/types.js';
import type { ScheduledActionDef } from '../store/team-snapshot.js';
import { packAgent, unpackAgent } from './agent-bundle.js';
import { AgentNameTaken, captureAgent, restoreAgent, templateFrom, type AgentTarget } from './agent-transfer.js';

const provider = { name: 'anthropic' } as AIProvider;
const action: ScheduledActionDef = { id: 'act-1', label: 'Diary', description: 'Write it', intervalSeconds: 86400, createdAt: '2026-11-01' };

/** Just enough of an agent to be saved and made again. */
function fakeAgent(config: AgentConfig): IAgent & { threads: Record<string, unknown[]> } {
  const agent = {
    id: config.id!, name: config.identity.name, config, threads: {} as Record<string, unknown[]>,
    getAllThreadHistories: () => ({
      general: [{ role: 'user', content: 'Hello Poppy', timestamp: new Date('2026-11-01T09:00:00Z') }],
      diary: [{ role: 'assistant', content: 'Dear diary', timestamp: new Date('2026-11-01T10:00:00Z') }],
    }),
    setAllThreadHistories: (t: Record<string, unknown[]>) => { agent.threads = t; },
  };
  return agent as unknown as IAgent & { threads: Record<string, unknown[]> };
}

const poppyConfig: AgentConfig = {
  id: 'poppy-1', templateId: 'tpl-poppy',
  identity: { name: 'Poppy', visualDescription: 'a writer', avatar: 'poppy.glb', voice: 'en_GB-alba' },
  hatType: ['green'], provider, model: 'claude-x',
  teamContext: 'You are on the diary team',
  personalMcpCredentials: { email: { MCP_EMAIL_PASSWORD: 'secret-pw' } },
  maxCostPerHour: 0.5, instructions: 'Write daily', upfrontTools: ['mcp__diary__*'],
};

let root: string;
let registered: IAgent[];
let assigned: Record<string, string[]>;
let target: AgentTarget;
const actionsHere = new Map<string, ScheduledActionDef>();

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'hats-agent-transfer-'));
  await mkdir(path.join(root, 'project', 'agents', 'poppy-1'), { recursive: true });
  await writeFile(path.join(root, 'project', 'agents', 'poppy-1', 'memory.json'), '{"entities":["Ian"]}');
  await mkdir(path.join(root, 'data', 'avatars'), { recursive: true });
  await writeFile(path.join(root, 'data', 'avatars', 'poppy.glb'), 'GLB');
  registered = []; assigned = {}; actionsHere.clear();
  target = {
    hasAgentNamed: (n) => n.toLowerCase() === 'poppy' || registered.some((a) => a.name.toLowerCase() === n.toLowerCase()),
    providerFor: () => provider,
    register: (config) => { const a = fakeAgent(config); registered.push(a); return a; },
    agentDirFor: (id) => path.join(root, 'project', 'agents', id),
    dataRoot: path.join(root, 'data'),
    actions: { addIfMissing: async (d) => { if (actionsHere.has(d.id)) return false; actionsHere.set(d.id, d); return true; } },
    assignActions: async (name, ids) => { assigned[name] = ids; },
  };
});

afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const capture = (includeCredentials: boolean) => captureAgent({
  agent: fakeAgent(poppyConfig),
  scheduledActionIds: ['act-1'],
  agentDir: path.join(root, 'project', 'agents', 'poppy-1'),
  dataRoot: path.join(root, 'data'),
  actions: { get: (id) => (id === 'act-1' ? action : undefined) },
}, { includeCredentials });

describe('a duplicate', () => {
  it('is a new agent with the new name and everything the first one had', async () => {
    const report = await restoreAgent(target, await capture(true), { name: 'Poppy Two' });
    const copy = registered[0]! as IAgent & { threads: Record<string, unknown[]> };

    expect(copy.name).toBe('Poppy Two');
    expect(copy.id).not.toBe('poppy-1');
    expect(copy.config).toMatchObject({
      templateId: 'tpl-poppy', model: 'claude-x', maxCostPerHour: 0.5, instructions: 'Write daily',
      upfrontTools: ['mcp__diary__*'], personalMcpCredentials: { email: { MCP_EMAIL_PASSWORD: 'secret-pw' } },
    });
    expect(Object.keys(copy.threads)).toEqual(['general', 'diary']);
    expect(await readFile(path.join(root, 'project', 'agents', report.id, 'memory.json'), 'utf8')).toContain('Ian');
    expect(assigned['Poppy Two']).toEqual(['act-1']);
  });

  it('must have a name no agent here has', async () => {
    await expect(restoreAgent(target, await capture(true), { name: 'poppy' })).rejects.toBeInstanceOf(AgentNameTaken);
    await expect(restoreAgent(target, await capture(true), { name: '  ' })).rejects.toBeInstanceOf(AgentNameTaken);
    expect(registered).toHaveLength(0);
  });
});

describe('a saved agent', () => {
  it('reads back as it was written', async () => {
    const back = await unpackAgent(await packAgent(await capture(false)));
    expect(back.manifest).toMatchObject({ format: 'hats-agent', name: 'Poppy', voices: ['en_GB-alba'] });
    expect(back.threads['diary']?.[0]?.content).toBe('Dear diary');
    expect(new TextDecoder().decode(back.files.get('memory.json'))).toContain('Ian');
    expect(back.assets.has('avatars/poppy.glb')).toBe(true);
    expect(back.scheduledActions).toEqual([action]);
  });

  it('leaves out a memory write caught half done', async () => {
    const dir = path.join(root, 'project', 'agents', 'poppy-1');
    await writeFile(path.join(dir, 'memory.json.0a1b2c.tmp'), '{"entit');
    await writeFile(path.join(dir, 'memory.json.lock'), 'token');
    expect([...(await capture(false)).files.keys()]).toEqual(['memory.json']);
  });

  it('carries no logins unless asked to', async () => {
    const without = await capture(false);
    expect(without.credentials).toBeUndefined();
    expect(JSON.stringify(without.definition)).not.toContain('secret-pw');
    expect(without.manifest.includesCredentials).toBe(false);
    expect((await capture(true)).credentials).toEqual(poppyConfig.personalMcpCredentials);
  });

  it('arrives on another machine with its avatar and actions, keeping what is there', async () => {
    const saved = await packAgent(await capture(false));
    // The other machine: no avatar of that name, the action already there.
    await rm(path.join(root, 'data', 'avatars', 'poppy.glb'));
    actionsHere.set('act-1', action);
    const report = await restoreAgent(target, await unpackAgent(saved), { name: 'Poppy (moved)' });
    expect(report.assets.added).toEqual(['avatars/poppy.glb']);
    expect(report.scheduledActions).toEqual({ added: 0, kept: 1 });
    expect(existsSync(path.join(root, 'data', 'avatars', 'poppy.glb'))).toBe(true);
  });
});

describe('a library template from an agent', () => {
  it('keeps its settings but not this project\'s context or its logins', async () => {
    const def = (await capture(true)).definition;
    const template = templateFrom({ ...def, personalMcpCredentials: poppyConfig.personalMcpCredentials }, ' Diarist ');
    expect(template).toMatchObject({ identity: { name: 'Diarist', avatar: 'poppy.glb' }, model: 'claude-x', maxCostPerHour: 0.5 });
    expect(template.id).not.toBe(def.id);
    expect(template).not.toHaveProperty('templateId');
    expect(template).not.toHaveProperty('teamContext');
    expect(template).not.toHaveProperty('personalMcpCredentials');
  });
});
