import { describe, it, expect } from 'vitest';
import { forThisMachine, platformCommand } from './saved-config.js';
import type { MCPServerConfig } from './config.js';

const savedOnWindows: MCPServerConfig = {
  transport: 'stdio', command: 'npx.cmd', args: ['-y', '@modelcontextprotocol/server-brave-search'],
  env: { BRAVE_API_KEY: '' },
};

describe('the launcher', () => {
  it('drops the .cmd shim a Windows save left, off Windows', () => {
    expect(platformCommand('npx.cmd', 'linux')).toBe('npx');
    expect(platformCommand('npm', 'win32')).toBe('npm.cmd');
    expect(platformCommand('npx.cmd', 'win32')).toBe('npx.cmd');
  });

  it('leaves other commands alone', () => {
    expect(platformCommand('node', 'linux')).toBe('node');
    expect(platformCommand('uvx', 'win32')).toBe('uvx');
  });
});

describe('a saved server restored in a container', () => {
  it('starts with the key now in .env, not the one saved with it', () => {
    const here = forThisMachine(savedOnWindows, { BRAVE_API_KEY: 'from-dotenv' }, 'linux');
    expect(here).toMatchObject({ command: 'npx', env: { BRAVE_API_KEY: 'from-dotenv' } });
  });

  it('keeps a saved value the runner has none of its own for', () => {
    const saved = { ...savedOnWindows, env: { BRAVE_API_KEY: 'saved' } };
    expect(forThisMachine(saved, { BRAVE_API_KEY: '' }, 'linux')).toMatchObject({ env: { BRAVE_API_KEY: 'saved' } });
  });

  it('leaves http servers as they are', () => {
    const http: MCPServerConfig = { transport: 'http', url: 'http://x/mcp' };
    expect(forThisMachine(http, {}, 'linux')).toBe(http);
  });
});
