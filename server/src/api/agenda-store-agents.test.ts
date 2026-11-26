// An agent's scheduled tasks follow the agent: deleted with it, renamed with
// it, and dropped when the agent turns out to be gone. Before this, a deleted
// "Poppy 2" kept checking Poppy's inbox every ten minutes for nobody.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { AgendaStore } from './agenda-store.js';

let dir = '';
let file = '';
let store: AgendaStore;

const imapCheck = (agentName: string, mcpOf = agentName) => store.add({
  agentName, label: `imap check unread - ${mcpOf}`, description: '', intervalSeconds: 600, type: 'mcp_tool_call',
  mcpToolCall: {
    serverName: 'email-imap', toolName: 'list_emails', args: {}, condition: '', messageTemplate: 'mail',
    personalMcpAgentName: mcpOf,
  },
});

const saved = async () => (JSON.parse(await readFile(file, 'utf-8')) as { agentName: string }[]).map(e => e.agentName);

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'hats-agenda-'));
  file = path.join(dir, 'agent-agenda.json');
  store = new AgendaStore(file);
  await imapCheck('Poppy');
  await imapCheck('Poppy 2', 'Poppy');
  await store.add({ agentName: 'Rhoda', label: 'News', description: '', intervalSeconds: 3600 });
});

afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('removing an agent\'s entries', () => {
  it('removes only that agent\'s, and saves', async () => {
    const removed = await store.removeAgent('Poppy 2');
    expect(removed.map(e => e.agentName)).toEqual(['Poppy 2']);
    expect(await saved()).toEqual(['Poppy', 'Rhoda']);
  });

  it('matches the name exactly', async () => {
    expect(await store.removeAgent('poppy')).toEqual([]);
    expect(store.list()).toHaveLength(3);
  });
});

describe('keeping only the agents on the team', () => {
  it('drops the entries of agents that are gone', async () => {
    const removed = await store.keepOnlyAgents(['Poppy', 'Rhoda']);
    expect(removed.map(e => e.agentName)).toEqual(['Poppy 2']);
    expect(await saved()).toEqual(['Poppy', 'Rhoda']);
  });

  it('changes nothing when every agent is there', async () => {
    expect(await store.keepOnlyAgents(['Poppy', 'Poppy 2', 'Rhoda'])).toEqual([]);
    expect(store.list()).toHaveLength(3);
  });
});

describe('renaming an agent', () => {
  it('moves its entries, and tool calls on its own MCP, to the new name', async () => {
    expect(await store.renameAgent('Poppy', 'Penny')).toBe(2);
    const byAgent = Object.fromEntries(store.list().map(e => [e.agentName, e.mcpToolCall?.personalMcpAgentName]));
    expect(byAgent).toEqual({ Penny: 'Penny', 'Poppy 2': 'Penny', Rhoda: undefined });
    expect(await saved()).toEqual(['Penny', 'Poppy 2', 'Rhoda']);
  });

  it('leaves other agents\' entries alone', async () => {
    expect(await store.renameAgent('Nobody', 'Someone')).toBe(0);
    expect(store.list().map(e => e.agentName)).toEqual(['Poppy', 'Poppy 2', 'Rhoda']);
  });
});
