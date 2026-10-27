/**
 * Where the Settings panel keeps what it saves, and loading it back.
 *
 * Run from the repo, that is .env, which `--env-file` loads at startup. In a
 * container it is not: compose copies .env into the environment once, when the
 * container is created, and nothing read the /app/.env the panel wrote — so a
 * setting lasted until the next restart. HATS_SETTINGS_FILE names a file in the
 * data directory instead, and it is loaded here before anything reads config.
 *
 * Some values must not come from it. Compose points service URLs at
 * host.docker.internal because localhost in a container is the container; a
 * saved localhost would undo that. HATS_ENV_LOCKED names them, and a saved
 * value for one is kept on file but never applied.
 */

import { readFileSync } from 'fs';
import { parseEnv } from './api/env-manager.js';

export const DEFAULT_SETTINGS_FILE = './.env';

/** The file the Settings panel reads and writes. */
export function settingsFile(env: Record<string, string | undefined> = process.env): string {
  return env['HATS_SETTINGS_FILE'] || DEFAULT_SETTINGS_FILE;
}

/** Keys the settings file may not change, from HATS_ENV_LOCKED. */
export function lockedKeys(env: Record<string, string | undefined> = process.env): Set<string> {
  return new Set((env['HATS_ENV_LOCKED'] ?? '').split(',').map(k => k.trim()).filter(Boolean));
}

/**
 * Saved values to apply: everything but the locked keys and the blanks. The
 * panel saves every field it shows, so a key that was not yet in .env the
 * first time someone pressed Save sits in the file as KEY= — and applied, that
 * blank would hide the key added to .env afterwards, on every start.
 */
export function applicable(saved: Record<string, string>, locked: Set<string>): Record<string, string> {
  return Object.fromEntries(Object.entries(saved).filter(([k, v]) => !locked.has(k) && v !== ''));
}

/**
 * Apply the settings file to the environment. Only when one is named: the
 * default .env is already loaded by --env-file, and reloading it would undo
 * anything the shell set on purpose.
 */
export function loadSettingsFile(env: Record<string, string | undefined> = process.env): string[] {
  if (!env['HATS_SETTINGS_FILE']) return [];
  let raw = '';
  try { raw = readFileSync(env['HATS_SETTINGS_FILE'], 'utf-8'); } catch { return []; }
  const saved = Object.fromEntries(parseEnv(raw).map(e => [e.key, e.value]));
  const apply = applicable(saved, lockedKeys(env));
  Object.assign(env, apply);
  return Object.keys(apply);
}
