import { describe, it, expect, vi } from 'vitest';
import { AgendaStore, type AgendaEntry } from '../api/agenda-store.js';
import { AgendaRunner, failureUpdate } from './agenda-runner.js';
import type { MCPRegistry } from '../mcp/mcp-registry.js';

describe('recording when an entry ran', () => {
  it('stamps a repeating entry and schedules its next run', async () => {
    const store = new AgendaStore(null);
    const e = await store.add({ agentName: 'Rhoda', label: 'Check Kanban', description: 'look', intervalSeconds: 600 });
    const runner = new AgendaRunner(store, async () => {});

    const before = Date.now();
    await runner.tick(true);

    const after = store.get(e.id)!;
    expect(after.lastRunAt).toBeGreaterThanOrEqual(before);
    expect(after.nextRunAt).toBe(after.lastRunAt! + 600_000);
  });

  it('stamps a one-off entry as it switches it off', async () => {
    const store = new AgendaStore(null);
    const e = await store.add({ agentName: 'Rhoda', label: 'Once', description: 'now', intervalSeconds: null });
    await new AgendaRunner(store, async () => {}).tick(true);

    expect(store.get(e.id)).toMatchObject({ enabled: false });
    expect(store.get(e.id)!.lastRunAt).toBeTypeOf('number');
  });

  it('leaves it unstamped when firing fails, records why, and retries on the next check', async () => {
    const store = new AgendaStore(null);
    const e = await store.add({ agentName: 'Rhoda', label: 'x', description: 'y', intervalSeconds: 600 });
    const before = Date.now();
    await new AgendaRunner(store, async () => { throw new Error('no agent'); }, null, () => null, 60_000).tick(true);

    const after = store.get(e.id)!;
    expect(after.lastRunAt).toBeUndefined();
    expect(after).toMatchObject({ lastError: 'no agent', failures: 1 });
    expect(after.nextRunAt).toBeLessThanOrEqual(before + 61_000);
  });

  it('clears the error once it succeeds', async () => {
    const store = new AgendaStore(null);
    const e = await store.add({ agentName: 'Rhoda', label: 'x', description: 'y', intervalSeconds: 600 });
    await new AgendaRunner(store, async () => { throw new Error('not yet'); }).tick(true);
    await new AgendaRunner(store, async () => {}).tick(true);

    expect(store.get(e.id)).toMatchObject({ failures: 0 });
    expect(store.get(e.id)!.lastError).toBeUndefined();
    expect(store.get(e.id)!.lastRunAt).toBeTypeOf('number');
  });
});

describe('an MCP check', () => {
  const imapEntry = (store: AgendaStore) => store.add({
    agentName: 'Poppy', label: 'imap check', description: '', intervalSeconds: 600, type: 'mcp_tool_call',
    mcpToolCall: {
      serverName: 'email-imap', toolName: 'mcp__email-imap__list_emails', args: {},
      condition: '!result.startsWith("No ")', messageTemplate: 'You have new email', personalMcpAgentName: 'Poppy',
    },
  });
  const registry = (result: string) => ({ callTool: async () => result }) as unknown as MCPRegistry;

  it('uses the agent\'s personal servers even when there are no shared ones', async () => {
    const store = new AgendaStore(null);
    await imapEntry(store);
    const sent: string[] = [];
    await new AgendaRunner(store, async (_n, m) => { sent.push(m.content); }, null, () => registry('1 unread')).tick(true);
    expect(sent).toEqual(['You have new email']);
  });

  it('does not message the agent when the condition is not met — and that still counts as a run', async () => {
    const store = new AgendaStore(null);
    const e = await imapEntry(store);
    const sent: string[] = [];
    await new AgendaRunner(store, async (_n, m) => { sent.push(m.content); }, null, () => registry('No emails')).tick(true);
    expect(sent).toEqual([]);
    expect(store.get(e.id)!.lastRunAt).toBeTypeOf('number');
  });

  it('fails, rather than counting as run, when no server has the tool yet', async () => {
    const store = new AgendaStore(null);
    const e = await imapEntry(store);
    await new AgendaRunner(store, async () => {}, null, () => null).tick(true);
    expect(store.get(e.id)!.lastRunAt).toBeUndefined();
    expect(store.get(e.id)!.lastError).toMatch(/no MCP servers/);
  });
});

describe('starting up', () => {
  it('waits for the first check before firing, so the team is there to receive it', async () => {
    vi.useFakeTimers();
    try {
      const store = new AgendaStore(null);
      await store.add({ agentName: 'Rhoda', label: 'x', description: 'y', intervalSeconds: 600 });
      const sent: string[] = [];
      const runner = new AgendaRunner(store, async (n) => { sent.push(n); }, null, () => null, 60_000);
      runner.start();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(sent).toEqual([]);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(sent).toEqual(['Rhoda']);
      runner.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('backing off', () => {
  const entry = (extra: Partial<AgendaEntry>): AgendaEntry => ({
    id: 'e', agentName: 'Rhoda', label: 'x', description: '', intervalSeconds: 600,
    nextRunAt: 0, enabled: true, createdAt: '', ...extra,
  });

  it('retries quickly at first, then falls back to the normal interval', () => {
    expect(failureUpdate(entry({}), 'x', 0, 60_000)).toMatchObject({ failures: 1, nextRunAt: 60_000 });
    expect(failureUpdate(entry({ failures: 2 }), 'x', 0, 60_000)).toMatchObject({ failures: 3, nextRunAt: 600_000 });
  });

  it('switches off a one-off that keeps failing', () => {
    expect(failureUpdate(entry({ intervalSeconds: null, failures: 2 }), 'x', 0, 60_000)).toMatchObject({ enabled: false });
  });
});

describe('running an entry now, to test it', () => {
  it('fires a paused one-off without using it up or moving its schedule', async () => {
    const store = new AgendaStore(null);
    const e = await store.add({ agentName: 'Rhoda', label: 'Once', description: 'now', intervalSeconds: null, delaySeconds: 3600 });
    await store.update(e.id, { enabled: false });
    const scheduled = store.get(e.id)!.nextRunAt;
    const sent: string[] = [];

    const outcome = await new AgendaRunner(store, async (n) => { sent.push(n); }).runNow(e.id);

    expect(outcome).toEqual({ delivered: true });
    expect(sent).toEqual(['Rhoda']);
    expect(store.get(e.id)).toMatchObject({ enabled: false, nextRunAt: scheduled });
    expect(store.get(e.id)!.lastRunAt).toBeTypeOf('number');
  });

  it('reports what an MCP check returned and that its condition held the message back', async () => {
    const store = new AgendaStore(null);
    const e = await store.add({
      agentName: 'Poppy', label: 'imap', description: '', intervalSeconds: 600, type: 'mcp_tool_call',
      mcpToolCall: { serverName: 's', toolName: 't', args: {}, condition: 'result !== "none"', messageTemplate: 'go' },
    });
    const registry = { callTool: async () => 'none' } as unknown as MCPRegistry;
    expect(await new AgendaRunner(store, async () => {}, registry).runNow(e.id)).toEqual({ delivered: false, result: 'none' });
  });

  it('reports a failure without counting it towards the backoff', async () => {
    const store = new AgendaStore(null);
    const e = await store.add({ agentName: 'Rhoda', label: 'x', description: 'y', intervalSeconds: 600 });
    const scheduled = store.get(e.id)!.nextRunAt;
    const outcome = await new AgendaRunner(store, async () => { throw new Error('no agent'); }).runNow(e.id);

    expect(outcome).toEqual({ delivered: false, error: 'no agent' });
    expect(store.get(e.id)).toMatchObject({ lastError: 'no agent', nextRunAt: scheduled });
    expect(store.get(e.id)!.failures ?? 0).toBe(0);
  });

  it('refuses an id it does not have', async () => {
    await expect(new AgendaRunner(new AgendaStore(null), async () => {}).runNow('nope')).rejects.toThrow(/No such/);
  });
});
