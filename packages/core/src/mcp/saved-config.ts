/**
 * Fitting a saved MCP server config to the machine it is restored on.
 *
 * Projects save each shared server as it was resolved when it connected: the
 * launcher for that platform (npx.cmd on Windows) and the env values the
 * runner had then. Restored as written, a project saved on Windows would not
 * start a server in a Linux container, and a key that was blank or old at save
 * time would win over the one now in .env.
 */

import type { MCPServerConfig } from './config.js';

const WINDOWS_SHIMS = ['npx', 'npm'];

/** npx and npm need their .cmd shim on Windows, and must lose it elsewhere. */
export function platformCommand(command: string, platform: NodeJS.Platform = process.platform): string {
  const bare = command.replace(/\.cmd$/i, '');
  if (!WINDOWS_SHIMS.includes(bare)) return command;
  return platform === 'win32' ? `${bare}.cmd` : bare;
}

/** A saved config with this machine's launcher, and this runner's value for any env key it has one for. */
export function forThisMachine(
  config: MCPServerConfig,
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
): MCPServerConfig {
  if (config.transport !== 'stdio') return config;
  const saved = Object.entries(config.env ?? {});
  return {
    ...config,
    command: platformCommand(config.command, platform),
    ...(saved.length > 0 && { env: Object.fromEntries(saved.map(([k, v]) => [k, env[k] || String(v)])) }),
  };
}
