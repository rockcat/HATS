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

const SECRET_NAME = /(KEY|SECRET|TOKEN|PASSWORD|PASS|AUTHORIZATION)$/i;
/** Short values are too likely to appear by chance to be put back as ${NAME}. */
const MIN_SECRET_LENGTH = 8;

/**
 * A config fit to be written down: nothing in it that came from this
 * runner's environment. An env value equal to the runner's own is blanked,
 * since forThisMachine fills it from the environment again on restore; a
 * header holding one gets its ${NAME} back, which the client fills when it
 * connects. With dropSecrets, as for an export without credentials, anything
 * named like a secret is blanked as well, wherever it came from.
 */
export function portableConfig(
  config: MCPServerConfig,
  env: Record<string, string | undefined> = process.env,
  { dropSecrets = false }: { dropSecrets?: boolean } = {},
): MCPServerConfig {
  if (config.transport === 'stdio') {
    if (!config.env) return config;
    const fromEnv = (k: string, v: string) => !!env[k] && v === env[k];
    return {
      ...config,
      env: Object.fromEntries(Object.entries(config.env).map(([k, v]) =>
        [k, fromEnv(k, String(v)) || (dropSecrets && SECRET_NAME.test(k)) ? '' : v])),
    };
  }
  const headers = (config as { headers?: Record<string, string> }).headers;
  if (!headers) return config;
  const secrets = Object.entries(env).filter((e): e is [string, string] =>
    SECRET_NAME.test(e[0]) && (e[1]?.length ?? 0) >= MIN_SECRET_LENGTH);
  const restore = (value: string) => secrets.reduce((v, [k, s]) => v.split(s).join(`\${${k}}`), value);
  return {
    ...config,
    headers: Object.fromEntries(Object.entries(headers).map(([name, value]) => {
      const back = restore(value);
      const literal = back.replace(/\$\{[^}]+\}/g, '').replace(/^\s*Bearer\s*/i, '').trim();
      return [name, dropSecrets && SECRET_NAME.test(name) && literal ? '' : back];
    })),
  } as MCPServerConfig;
}
