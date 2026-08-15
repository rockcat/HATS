import { appendFileSync, mkdirSync } from 'fs';
import * as path from 'path';

/** Shared debug flags — mutated at runtime via the API. */
export const debugState = {
  logPrompts: false,
};

const LOG_FILE = path.join(process.cwd(), 'prompt-debug.log');

function ensureLogDir(): void {
  try { mkdirSync(path.dirname(LOG_FILE), { recursive: true }); } catch { /* ignore */ }
}

/** Format a token count for log output: ≥1 000 → "4.1k", otherwise raw number. */
export function tk(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** Write a block to prompt-debug.log (and stdout). Only call when logPrompts is true. */
export function writePromptLog(lines: string[]): void {
  const block = lines.join('\n') + '\n';
  process.stdout.write(block);
  try {
    ensureLogDir();
    appendFileSync(LOG_FILE, block, 'utf-8');
  } catch { /* ignore write errors */ }
}
