import { describe, it, expect } from 'vitest';
import { forThisMachine, platformCommand, portableConfig } from './saved-config.js';
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

describe('a server config as it is written down', () => {
  const env = { BRAVE_API_KEY: 'brave-secret-1', GOOGLE_ACCESS_TOKEN: 'ya29.token-abc', HOME: '/root' };

  it('leaves out keys that came from the environment', () => {
    const saved = portableConfig({ ...savedOnWindows, env: { BRAVE_API_KEY: 'brave-secret-1', PROJECT: '/p' } }, env);
    expect(saved).toMatchObject({ env: { BRAVE_API_KEY: '', PROJECT: '/p' } });
  });

  it('keeps a key typed into the config, which the environment cannot give back', () => {
    const saved = portableConfig({ ...savedOnWindows, env: { BRAVE_API_KEY: 'typed-in-key' } }, env);
    expect(saved).toMatchObject({ env: { BRAVE_API_KEY: 'typed-in-key' } });
  });

  it('drops anything named like a secret for an export without credentials', () => {
    const saved = portableConfig({ ...savedOnWindows, env: { BRAVE_API_KEY: 'typed-in-key', PROJECT: '/p' } }, env, { dropSecrets: true });
    expect(saved).toMatchObject({ env: { BRAVE_API_KEY: '', PROJECT: '/p' } });
  });

  it('puts a header back to the placeholder it was filled from', () => {
    const http: MCPServerConfig = { transport: 'http', url: 'http://g', headers: { Authorization: 'Bearer ya29.token-abc' } } as MCPServerConfig;
    expect(portableConfig(http, env)).toMatchObject({ headers: { Authorization: 'Bearer ${GOOGLE_ACCESS_TOKEN}' } });
  });

  it('drops a literal credential header for an export without credentials', () => {
    const http = { transport: 'http', url: 'http://g', headers: { Authorization: 'Bearer pasted-token-xyz', Accept: 'json' } } as MCPServerConfig;
    expect(portableConfig(http, env, { dropSecrets: true })).toMatchObject({ headers: { Authorization: '', Accept: 'json' } });
  });
});
