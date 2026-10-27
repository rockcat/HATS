import { readFile, writeFile } from 'fs/promises';

const SECRET_PATTERN = /(_API_KEY|_SECRET|_TOKEN|_PASSWORD)$/i;

export interface EnvEntry {
  key: string;
  value: string;
  isSecret: boolean;
}

/** Parse a .env file into an ordered list of key/value entries (comments and blanks skipped). */
export async function readEnvFile(filePath: string): Promise<EnvEntry[]> {
  let raw = '';
  try { raw = await readFile(filePath, 'utf-8'); } catch { return []; }
  return parseEnv(raw);
}

/**
 * The file's entries plus, for each asked-for key it does not mention, the
 * value the process is actually running with. In a container the settings
 * file starts empty while .env arrives through the environment, and a panel
 * showing only the file would look as though nothing were configured.
 */
export function withEffective(entries: EnvEntry[], keys: string[], env: Record<string, string | undefined>): EnvEntry[] {
  const inFile = new Set(entries.map(e => e.key));
  // A blank on file is not applied (see settings-file.ts), so show what runs.
  const shown = entries.map(e => (e.value === '' && env[e.key] ? { ...e, value: env[e.key]! } : e));
  const extra = keys
    .filter(k => !inFile.has(k) && env[k] !== undefined)
    .map(k => ({ key: k, value: env[k]!, isSecret: SECRET_PATTERN.test(k) }));
  return [...shown, ...extra];
}

/** The entries in a .env file's text — the part that does not touch the disk. */
export function parseEnv(raw: string): EnvEntry[] {
  const entries: EnvEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    entries.push({ key, value, isSecret: SECRET_PATTERN.test(key) });
  }
  return entries;
}

/**
 * Write updated key/value pairs back to the .env file.
 * Existing keys are updated in-place; new keys are appended.
 */
export async function writeEnvFile(filePath: string, updates: Record<string, string>): Promise<void> {
  let raw = '';
  try { raw = await readFile(filePath, 'utf-8'); } catch { /* new file */ }

  const handled = new Set<string>();
  const lines = raw.split(/\r?\n/);

  const newLines = lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) return line;
    const key = trimmed.slice(0, eqIdx).trim();
    if (key in updates) {
      handled.add(key);
      return `${key}=${updates[key]}`;
    }
    return line;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (!handled.has(key)) newLines.push(`${key}=${value}`);
  }

  // Remove trailing blank lines then add one newline at end
  while (newLines.length > 0 && !newLines[newLines.length - 1]!.trim()) newLines.pop();
  await writeFile(filePath, newLines.join('\n') + '\n', 'utf-8');
}
