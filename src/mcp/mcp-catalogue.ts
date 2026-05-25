import os from 'os';
import path from 'path';
import { MCPServerConfig } from './mcp-client.js';

const expandTilde = (s: string) =>
  s.startsWith('~/') ? path.join(os.homedir(), s.slice(2)) : s;

export type MCPCategory = 'productivity' | 'files' | 'web' | 'data' | 'dev';

export interface MCPCatalogueEntry {
  id: string;
  name: string;
  description: string;
  category: MCPCategory;
  config: MCPServerConfig;
  envVars?: string[];   // env var names required by this server
  personal?: boolean;   // true = per-agent credentials; each agent configures their own instance
  notes?: string;
  url?: string;         // link to docs / source for the setup page
}

/** Resolves env vars and platform-specific command names at connect time.
 *  Also expands ~/ prefix in args to the user's home directory. */
export function resolveConfig(config: MCPServerConfig): MCPServerConfig {
  if (config.transport !== 'stdio') return config;

  const resolved: Record<string, string> = {};
  for (const [k] of Object.entries(config.env ?? {})) {
    resolved[k] = process.env[k] ?? '';
  }

  let command = config.command;
  if (process.platform === 'win32' && (command === 'npx' || command === 'npm')) {
    command = command + '.cmd';
  }

  return {
    ...config,
    command,
    args: config.args?.map(expandTilde),
    ...(Object.keys(resolved).length > 0 ? { env: resolved } : {}),
  };
}

/** Build a config for a personal MCP instance using per-agent credentials directly. */
export function resolvePersonalConfig(entry: MCPCatalogueEntry, credentials: Record<string, string>): MCPServerConfig {
  if (entry.config.transport !== 'stdio') return entry.config;
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...(entry.config.env ?? {}),
    ...credentials,
  };
  let command = entry.config.command;
  if (process.platform === 'win32' && (command === 'npx' || command === 'npm')) {
    command = command + '.cmd';
  }
  return { ...entry.config, command, args: entry.config.args?.map(expandTilde), env };
}
