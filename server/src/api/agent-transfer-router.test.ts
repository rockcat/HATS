import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';
import type { IAgent } from '../agent/iagent.js';
import type { AgentConfig } from '../agent/types.js';
import type { AIProvider } from '../providers/types.js';
import type { TeamOrchestrator } from '../orchestrator/orchestrator.js';
import type { AgentDefinition } from '../store/team-snapshot.js';
import { AgentTransferRouter, importUrl, type AgentTransferRouterDeps } from './agent-transfer-router.js';

function fakeAgent(config: AgentConfig): IAgent {
  let threads: Record<string, unknown[]> = { general: [{ role: 'user', content: 'hi', timestamp: '2026-11-01T09:00:00Z' }] };
  return {
    id: config.id!, name: config.identity.name, config,
    getAllThreadHistories: () => threads,
    setAllThreadHistories: (t: Record<string, unknown[]>) => { threads = t; },
  } as unknown as IAgent;
}

/** A runner with one agent, Poppy, and whoever arrives. */
function runner({ admin = true } = {}) {
  const agents: IAgent[] = [fakeAgent({
    id: 'poppy-1', identity: { name: 'Poppy', visualDescription: 'a writer' }, hatType: ['green'],
    provider: { name: 'anthropic' } as AIProvider, model: 'claude-x',
    personalMcpCredentials: { email: { MCP_EMAIL_PASSWORD: 'pw' } },
  })];
  const library: AgentDefinition[] = [];
  const replies: { status: number; body: Record<string, unknown> }[] = [];
  const orch = {
    getAgent: (n: string) => agents.find((a) => a.name.toLowerCase() === n.toLowerCase()),
    listAgents: () => agents,
    registerAgent: (c: AgentConfig) => { const a = fakeAgent(c); agents.push(a); return a; },
    agentDir: () => undefined,
    getProjectDir: () => null,
    getAgendaStore: () => null,
  } as unknown as TeamOrchestrator;
  const deps: AgentTransferRouterDeps = {
    getOrchestrator: () => orch,
    getAgentStore: () => ({
      list: () => library,
      addOrUpdate: async (d: AgentDefinition) => { library.push(d); return d; },
    }) as never,
    getActionStore: () => null,
    dataRoot: '/nowhere',
    resolveAgentName: (n) => n,
    isAdmin: () => admin,
    agentsChanged: vi.fn(),
    json: (_res, status, body) => { replies.push({ status, body: body as Record<string, unknown> }); },
    readBody: async (req) => (req as unknown as { text: string }).text ?? '',
    readBodyBuffer: async (req) => (req as unknown as { bytes: Buffer }).bytes ?? Buffer.alloc(0),
  };
  const router = new AgentTransferRouter(deps);
  const call = (method: string, path: string, body: { text?: string; bytes?: Buffer } = {}, res?: unknown) =>
    router.handleRoutes(new URL(path, 'http://here').pathname, method, new URL(path, 'http://here'),
      body as unknown as IncomingMessage, (res ?? {}) as ServerResponse);
  return { agents, library, replies, call, deps };
}

/** Collects what the export route writes. */
function download() {
  const chunks: { head?: Record<string, unknown>; body?: Buffer } = {};
  return {
    chunks,
    res: { writeHead: (_s: number, h: Record<string, unknown>) => { chunks.head = h; }, end: (b: Buffer) => { chunks.body = b; } },
  };
}

describe('duplicating an agent', () => {
  it('makes a copy under the new name, with its logins', async () => {
    const here = runner();
    await here.call('POST', '/api/agents/Poppy/duplicate', { text: JSON.stringify({ name: 'Poppy Two' }) });
    expect(here.replies[0]).toMatchObject({ status: 201, body: { name: 'Poppy Two' } });
    expect(here.agents[1]!.config.personalMcpCredentials).toEqual({ email: { MCP_EMAIL_PASSWORD: 'pw' } });
    expect(here.deps.agentsChanged).toHaveBeenCalled();
  });

  it('says so when the name is taken', async () => {
    const here = runner();
    await here.call('POST', '/api/agents/Poppy/duplicate', { text: JSON.stringify({ name: 'POPPY' }) });
    expect(here.replies[0]?.status).toBe(409);
  });
});

describe('moving an agent between runners', () => {
  it('loads on the other runner what this one saved', async () => {
    const here = runner();
    const { res, chunks } = download();
    await here.call('GET', '/api/agents/Poppy/export', {}, res);
    expect(String(chunks.head?.['Content-Disposition'])).toContain('Poppy.hats-agent.zip');

    const there = runner();
    await there.call('POST', '/api/agents/import?name=Poppy%20(home)', { bytes: chunks.body! });
    expect(there.replies[0]).toMatchObject({ status: 201, body: { name: 'Poppy (home)', threads: 1 } });
    // Saved without asking for logins, so none arrived.
    expect(there.agents[1]!.config.personalMcpCredentials).toBeUndefined();
  });

  it('keeps logins and loading for an admin', async () => {
    const user = runner({ admin: false });
    await user.call('GET', '/api/agents/Poppy/export?credentials=true', {}, download().res);
    await user.call('POST', '/api/agents/import', { bytes: Buffer.from('zip') });
    await user.call('POST', '/api/agents/Poppy/send', { text: '{}' });
    expect(user.replies.map((r) => r.status)).toEqual([403, 403, 403]);
  });

  it('turns a typed address into the other runner\'s import', () => {
    expect(importUrl('http://otherbox:3000/some/page', 'Poppy').href).toBe('http://otherbox:3000/api/agents/import?name=Poppy');
    expect(() => importUrl('otherbox:3000', 'Poppy')).toThrow(/http/);
    expect(() => importUrl('', 'Poppy')).toThrow(/not an address/);
  });
});

describe('an agent made into a template', () => {
  it('goes into the library under the name given', async () => {
    const here = runner();
    await here.call('POST', '/api/agents/Poppy/to-library', { text: JSON.stringify({ name: 'Diarist' }) });
    expect(here.replies[0]).toMatchObject({ status: 201, body: { name: 'Diarist' } });
    expect(here.library[0]).not.toHaveProperty('personalMcpCredentials');
  });

  it('will not take a name the library already has', async () => {
    const here = runner();
    here.library.push({ identity: { name: 'Diarist' } } as AgentDefinition);
    await here.call('POST', '/api/agents/Poppy/to-library', { text: JSON.stringify({ name: 'diarist' }) });
    expect(here.replies[0]?.status).toBe(409);
  });
});

let fetchSpy: ReturnType<typeof vi.spyOn> | undefined;
beforeEach(() => { fetchSpy = undefined; });
afterEach(() => { fetchSpy?.mockRestore(); });

describe('sending an agent', () => {
  it('posts it to the other runner with its key, and passes on a taken name', async () => {
    const here = runner();
    const sent: { url: string; auth: string | null }[] = [];
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      sent.push({ url: String(url), auth: new Headers(init?.headers).get('authorization') });
      return new Response(JSON.stringify({ error: 'There is already an agent called "Poppy"' }), { status: 409 });
    });
    await here.call('POST', '/api/agents/Poppy/send', { text: JSON.stringify({ url: 'http://otherbox:3000', apiKey: 'k3y' }) });
    expect(sent[0]).toEqual({ url: 'http://otherbox:3000/api/agents/import?name=Poppy', auth: 'Bearer k3y' });
    expect(here.replies[0]).toMatchObject({ status: 409, body: { remoteStatus: 409 } });
  });
});
