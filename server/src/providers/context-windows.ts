/**
 * Context window sizes, by model id.
 *
 * Learnt from the providers where they say: Anthropic's and Gemini's model
 * lists carry input limits, and OpenAI's model pages state them (read during
 * a pricing refresh). Saved to model-context.json beside the prices; the
 * built-in table covers older models nothing has reported.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { runtimeDir } from '../../../packages/core/src/runtime-dir.js';

interface ContextFile { updatedAt: string; models: Record<string, number> }

const CONTEXT_FILE = runtimeDir('data', 'model-context.json');

const BUILT_IN: Record<string, number> = {
  'claude-opus-4-7':            200_000,
  'claude-opus-4-6':            200_000,
  'claude-opus-4-5':            200_000,
  'claude-sonnet-4-6':          200_000,
  'claude-sonnet-4-5':          200_000,
  'claude-haiku-4-5':           200_000,
  'claude-haiku-4-5-20251001':  200_000,
  'claude-3-5-sonnet-20241022': 200_000,
  'claude-3-5-sonnet-20240620': 200_000,
  'claude-3-5-haiku-20241022':  200_000,
  'claude-3-opus-20240229':     200_000,
  'claude-3-sonnet-20240229':   200_000,
  'claude-3-haiku-20240307':    200_000,
  'gpt-4.1':                    1_047_576,
  'gpt-4.1-mini':               1_047_576,
  'gpt-4.1-nano':               1_047_576,
  'gpt-4o':                     128_000,
  'gpt-4o-mini':                128_000,
  'gpt-4-turbo':                128_000,
  'gpt-4':                      8_192,
  'gpt-3.5-turbo':              16_385,
  'o1':                         200_000,
  'o1-mini':                    128_000,
  'o1-preview':                 128_000,
  'o3':                         200_000,
  'o3-mini':                    200_000,
  'o4-mini':                    200_000,
  'gemini-2.5-pro':             1_048_576,
  'gemini-2.5-pro-preview':     1_048_576,
  'gemini-2.5-flash':           1_048_576,
  'gemini-2.5-flash-preview':   1_048_576,
  'gemini-2.0-flash':           1_048_576,
  'gemini-2.0-flash-lite':      1_048_576,
  'gemini-1.5-pro':             2_097_152,
  'gemini-1.5-flash':           1_048_576,
  'gemini-1.5-flash-8b':        1_048_576,
};

function load(): Record<string, number> {
  try {
    return (JSON.parse(readFileSync(CONTEXT_FILE, 'utf-8')) as ContextFile).models ?? {};
  } catch {
    return {};
  }
}

let learnt = load();

const isSize = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0;

/** Fold reported sizes in, saving only when something changed. Returns how many changed. */
export function recordContextWindows(sizes: Record<string, number | null | undefined>): number {
  let changed = 0;
  for (const [model, size] of Object.entries(sizes)) {
    if (isSize(size) && learnt[model] !== size) { learnt[model] = size; changed++; }
  }
  if (changed) {
    mkdirSync(dirname(CONTEXT_FILE), { recursive: true });
    const file: ContextFile = { updatedAt: new Date().toISOString(), models: learnt };
    writeFileSync(CONTEXT_FILE, JSON.stringify(file, null, 2), 'utf-8');
  }
  return changed;
}

/** Re-read model-context.json, e.g. after another process updated it. */
export function reloadContextWindows(): void {
  learnt = load();
}

/** Return the context window size in tokens for a model (defaults to 128k if unknown). */
export function getContextWindow(model: string): number {
  return learnt[model] ?? BUILT_IN[model] ?? 128_000;
}

/** Every known size, reported ones over built-in ones (for API exposure). */
export function getContextWindowTable(): Record<string, number> {
  return { ...BUILT_IN, ...learnt };
}
