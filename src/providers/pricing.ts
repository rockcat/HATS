import { readFileSync } from 'fs';
import { join } from 'path';

export interface ModelPricing {
  input:  number;   // $ per 1M input tokens
  output: number;   // $ per 1M output tokens
}

/** Providers whose models always cost zero (local inference). */
export const FREE_PROVIDERS = new Set(['ollama', 'lmstudio']);

interface PricingFileEntry { provider?: string; input: number; output: number; }
interface PricingFile { updatedAt?: string; models: Record<string, PricingFileEntry>; }

const PRICING_FILE = join(process.cwd(), 'data', 'model-pricing.json');

/** Hardcoded fallback used only when model-pricing.json is absent. */
const FALLBACK: Record<string, ModelPricing> = {
  'claude-opus-4-6':                { input: 15.00,  output: 75.00  },
  'claude-opus-4-5':                { input: 15.00,  output: 75.00  },
  'claude-sonnet-4-6':              { input:  3.00,  output: 15.00  },
  'claude-sonnet-4-5':              { input:  3.00,  output: 15.00  },
  'claude-haiku-4-5':               { input:  0.80,  output:  4.00  },
  'claude-haiku-4-5-20251001':      { input:  0.80,  output:  4.00  },
  'claude-3-5-sonnet-20241022':     { input:  3.00,  output: 15.00  },
  'claude-3-5-sonnet-20240620':     { input:  3.00,  output: 15.00  },
  'claude-3-5-haiku-20241022':      { input:  0.80,  output:  4.00  },
  'claude-3-opus-20240229':         { input: 15.00,  output: 75.00  },
  'claude-3-sonnet-20240229':       { input:  3.00,  output: 15.00  },
  'claude-3-haiku-20240307':        { input:  0.25,  output:  1.25  },
  'gpt-4.1':                        { input:  2.00,  output:  8.00  },
  'gpt-4.1-mini':                   { input:  0.40,  output:  1.60  },
  'gpt-4.1-nano':                   { input:  0.10,  output:  0.40  },
  'gpt-4o':                         { input:  2.50,  output: 10.00  },
  'gpt-4o-mini':                    { input:  0.15,  output:  0.60  },
  'gpt-4-turbo':                    { input: 10.00,  output: 30.00  },
  'gpt-4':                          { input: 30.00,  output: 60.00  },
  'gpt-3.5-turbo':                  { input:  0.50,  output:  1.50  },
  'o1':                             { input: 15.00,  output: 60.00  },
  'o1-mini':                        { input:  3.00,  output: 12.00  },
  'o1-preview':                     { input: 15.00,  output: 60.00  },
  'o3':                             { input: 10.00,  output: 40.00  },
  'o3-mini':                        { input:  1.10,  output:  4.40  },
  'o4-mini':                        { input:  1.10,  output:  4.40  },
  'gemini-2.5-pro':                 { input:  1.25,  output: 10.00  },
  'gemini-2.5-pro-preview':         { input:  1.25,  output: 10.00  },
  'gemini-2.5-flash':               { input:  0.075, output:  0.30  },
  'gemini-2.5-flash-preview':       { input:  0.075, output:  0.30  },
  'gemini-2.0-flash':               { input:  0.10,  output:  0.40  },
  'gemini-2.0-flash-lite':          { input:  0.075, output:  0.30  },
  'gemini-1.5-pro':                 { input:  1.25,  output:  5.00  },
  'gemini-1.5-flash':               { input:  0.075, output:  0.30  },
  'gemini-1.5-flash-8b':            { input:  0.0375, output: 0.15  },
};

function readPricingFile(): Record<string, ModelPricing> {
  try {
    const raw  = readFileSync(PRICING_FILE, 'utf-8');
    const data = JSON.parse(raw) as PricingFile;
    return Object.fromEntries(
      Object.entries(data.models).map(([k, v]) => [k, { input: v.input, output: v.output }]),
    );
  } catch {
    return { ...FALLBACK };
  }
}

let PRICING = readPricingFile();

/** Reload pricing data from model-pricing.json — call after an update without restarting. */
export function reloadPricingFromFile(): void {
  PRICING = readPricingFile();
}

/** Return pricing for a model, or `null` if unknown. */
export function getKnownPricing(model: string): ModelPricing | null {
  return PRICING[model] ?? null;
}

/** True if we have confirmed pricing data for this model. */
export function isKnownPricing(model: string): boolean {
  return model in PRICING;
}

/**
 * Return pricing for a model.
 * Local providers (ollama, lmstudio) always get zero cost.
 * Unknown cloud models fall back to a rough estimate so telemetry still shows something.
 */
export function getPricing(model: string, provider?: string): ModelPricing {
  if (provider && FREE_PROVIDERS.has(provider)) return { input: 0, output: 0 };
  return PRICING[model] ?? { input: 1.00, output: 3.00 };
}

/** Calculate cost in USD for a call. */
export function calcCost(model: string, inputTokens: number, outputTokens: number, provider?: string): number {
  const p = getPricing(model, provider);
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
}

/** Return the full pricing table (for API exposure). */
export function getPricingTable(): Record<string, ModelPricing> {
  return { ...PRICING };
}

/** Context window sizes in tokens per model. */
const CONTEXT_WINDOWS: Record<string, number> = {
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

/** Return the context window size in tokens for a model (defaults to 128k if unknown). */
export function getContextWindow(model: string): number {
  return CONTEXT_WINDOWS[model] ?? 128_000;
}

/** Return all known context window sizes (for API exposure). */
export function getContextWindowTable(): Record<string, number> {
  return { ...CONTEXT_WINDOWS };
}
