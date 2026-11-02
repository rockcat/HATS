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

  it('takes a key from the environment when the catalogue leaves it blank', () => {
    // The installed runner gets BRAVE_API_KEY from .env, and no agent has it
    // as a credential. The catalogue's empty placeholder used to replace it.
    const brave: MCPCatalogueEntry = {
      ...memory,
      id: 'brave-search',
      config: { transport: 'stdio', command: 'npx', args: ['-y', 'brave'], env: { BRAVE_API_KEY: '' } },
    };
    const before = process.env.BRAVE_API_KEY;
    process.env.BRAVE_API_KEY = 'from-env';
    try {
      const resolved = resolvePersonalConfig(brave, {}, '/projects/p/agents/aaa');
      expect('env' in resolved && resolved.env?.BRAVE_API_KEY).toBe('from-env');
    } finally {
      if (before === undefined) delete process.env.BRAVE_API_KEY; else process.env.BRAVE_API_KEY = before;
    }
  });

  it('still lets a credential win over the declared default', () => {
    const resolved = resolvePersonalConfig(
      memory, { MEMORY_FILE_PATH: '/somewhere/else.json' }, `${PROJECT}/agents/aaa`);
    expect(pathOf(resolved)).toBe('/somewhere/else.json');
  });
});

// ── Defaults the catalogue sets, and blanks an agent's form saves ────────────

const email: MCPCatalogueEntry = {
  id: 'email-imap',
  name: 'Email',
  description: 'IMAP and SMTP.',
  category: 'productivity',
  users: ['agent'],
  config: {
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@codefuturist/email-mcp'],
    env: { MCP_EMAIL_SEND_SAVE_TO_SENT: 'true' },
  },
};

const saveToSent = (config: MCPServerConfig) =>
  'env' in config ? config.env?.MCP_EMAIL_SEND_SAVE_TO_SENT : undefined;

describe('a catalogue default and an agent\'s own setting', () => {
  it('uses the default when the agent says nothing', () => {
    expect(saveToSent(resolvePersonalConfig(email, {}))).toBe('true');
  });

  it('lets the agent turn it off', () => {
    // Gmail files SMTP mail in Sent itself, so saving again doubles it.
    expect(saveToSent(resolvePersonalConfig(email, { MCP_EMAIL_SEND_SAVE_TO_SENT: 'false' })))
      .toBe('false');
  });

  it('does not let an empty box override the default', () => {
    // The agent form saves every field it shows, filled or not. email-mcp
    // reads `'' === 'true'` as false, so a blank used to switch it off.
    expect(saveToSent(resolvePersonalConfig(email, { MCP_EMAIL_SEND_SAVE_TO_SENT: '' })))
      .toBe('true');
  });
});

// ── One of our own servers, run for one agent ────────────────────────────────

describe('a built-in server for one agent', () => {
  it('is started from a real path, not the catalogue marker', () => {
    // The marker reached node as a file name: "Cannot find module '/app/builtin:diary/server'".
    const diary: MCPCatalogueEntry = {
      ...email,
      id: 'diary',
      config: { transport: 'stdio', command: 'node', args: ['builtin:diary/server'] },
    };
    const resolved = resolvePersonalConfig(diary, { DIARY_API_TOKEN: 't' });
    const args = resolved.transport === 'stdio' ? resolved.args ?? [] : [];
    expect(args.some((a) => a.startsWith('builtin:'))).toBe(false);
    expect(args.join(' ')).toMatch(/diary[\\/]server\.(js|ts)/);
  });
});
