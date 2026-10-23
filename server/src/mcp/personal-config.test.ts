import { describe, it, expect } from 'vitest';
import { resolveConfig, resolvePersonalConfig, type MCPCatalogueEntry } from '../../../packages/core/src/mcp/mcp-catalogue.js';
import type { MCPServerConfig } from './mcp-client.js';

/** The memory entry as the catalogue declares it. */
const memory: MCPCatalogueEntry = {
  id: 'memory',
  name: 'Memory',
  description: 'Persistent knowledge graph.',
  category: 'productivity',
  users: ['human', 'agent'],
  config: {
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    env: { MEMORY_FILE_PATH: '{AGENT_DIR}/memory.json' },
  },
};

const PROJECT = '/projects/paige';
const pathOf = (config: MCPServerConfig) =>
  'env' in config ? config.env?.MEMORY_FILE_PATH : undefined;

describe('where an agent keeps its memory', () => {
  it('gives each agent its own file', () => {
    // Without this every agent shared one graph, and nobody could say what any
    // one of them actually remembered.
    const poppy = resolvePersonalConfig(memory, {}, `${PROJECT}/agents/aaa`);
    const rhoda = resolvePersonalConfig(memory, {}, `${PROJECT}/agents/bbb`);

    expect(pathOf(poppy)).toBe(`${PROJECT}/agents/aaa/memory.json`);
    expect(pathOf(rhoda)).toBe(`${PROJECT}/agents/bbb/memory.json`);
    expect(pathOf(poppy)).not.toBe(pathOf(rhoda));
  });

  it('puts a team instance in the project, not an npx cache', () => {
    // Still one shared graph, but one somebody can find and back up.
    expect(pathOf(resolveConfig(memory.config, PROJECT))).toBe(`${PROJECT}/memory.json`);
  });

  it('keeps a team graph and an agent graph apart', () => {
    expect(pathOf(resolveConfig(memory.config, PROJECT)))
      .not.toBe(pathOf(resolvePersonalConfig(memory, {}, `${PROJECT}/agents/aaa`)));
  });

  it('falls back to a relative path when there is no project yet', () => {
    // Rather than leaving the literal placeholder in an env var.
    const resolved = pathOf(resolvePersonalConfig(memory, {}));
    expect(resolved).toBe('memory.json');
    expect(resolved).not.toContain('{AGENT_DIR}');
  });

  it('leaves a server that asks for no agent directory alone', () => {
    const plain: MCPCatalogueEntry = {
      ...memory,
      id: 'brave-search',
      config: { transport: 'stdio', command: 'npx', args: ['-y', 'brave'], env: { BRAVE_API_KEY: '' } },
    };
    const resolved = resolvePersonalConfig(plain, { BRAVE_API_KEY: 'secret' }, '/projects/p/agents/aaa');
    expect(pathOf(resolved)).toBeUndefined();
    expect('env' in resolved && resolved.env?.BRAVE_API_KEY).toBe('secret');
  });

  it('still lets a credential win over the declared default', () => {
    const resolved = resolvePersonalConfig(
      memory, { MEMORY_FILE_PATH: '/somewhere/else.json' }, `${PROJECT}/agents/aaa`);
    expect(pathOf(resolved)).toBe('/somewhere/else.json');
  });
});
