import os from 'os';
import path from 'path';
import { MCPServerConfig, interpolateHeaders } from './mcp-client.js';

const expandTilde = (s: string) =>
  s.startsWith('~/') ? path.join(os.homedir(), s.slice(2)) : s;

export type MCPCategory = 'productivity' | 'files' | 'web' | 'data' | 'dev';

export interface FeatureGroupDef {
  key: string;       // e.g. 'gmail.write'
  label: string;     // display label
  defaultOn: boolean;
}

export interface EnvVarDef {
  name: string;
  placeholder?: string;  // hint shown in the input field; defaults to the var name
  type?: 'text' | 'password' | 'features';
  features?: FeatureGroupDef[];
}

export type EnvVarEntry = string | EnvVarDef;

/** Extract the variable name from a string or object entry. */
export function envVarName(e: EnvVarEntry): string {
  return typeof e === 'string' ? e : e.name;
}

/** Extract the placeholder hint from a string or object entry. */
export function envVarPlaceholder(e: EnvVarEntry): string {
  return typeof e === 'string' ? e : (e.placeholder ?? e.name);
}

export type MCPUser = 'human' | 'agent';

export interface MCPCatalogueEntry {
  id: string;
  name: string;
  description: string;
  category: MCPCategory;
  config: MCPServerConfig;
  envVars?: EnvVarEntry[];  // env var names (or defs with placeholders) required by this server
  /** Who can use this MCP. 'human' = global shared; 'agent' = per-agent personal. Absent = ['human']. */
  users?: MCPUser[];
  notes?: string;
  url?: string;             // link to docs / source for the setup page
}

/** Returns true if this entry appears in the per-agent personal MCP section. */
export function isAgentMcp(e: MCPCatalogueEntry): boolean {
  return !!e.users?.includes('agent');
}

/** Returns true if this entry appears in the global shared MCP catalogue. */
export function isHumanMcp(e: MCPCatalogueEntry): boolean {
  return !!e.users?.includes('human');
}

/** Resolves env vars and platform-specific command names at connect time.
 *  Also expands ~/ prefix in args to the user's home directory. */
export function resolveConfig(config: MCPServerConfig): MCPServerConfig {
  if (config.transport === 'http') {
    return config.headers
      ? { ...config, headers: interpolateHeaders(config.headers, process.env as Record<string, string>) }
      : config;
  }
  if (config.transport !== 'stdio') return config;

  const resolved: Record<string, string> = {};
  for (const [k, configVal] of Object.entries(config.env ?? {})) {
    resolved[k] = process.env[k] ?? (configVal as string) ?? '';
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
  if (entry.config.transport === 'http') {
    const vars = { ...(process.env as Record<string, string>), ...credentials };
    return entry.config.headers
      ? { ...entry.config, headers: interpolateHeaders(entry.config.headers, vars) }
      : entry.config;
  }
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
