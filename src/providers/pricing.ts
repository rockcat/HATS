/**
 * Per-model pricing in USD per 1M tokens.
 * Used for telemetry cost estimation and UI warnings.
 *
 * Sources (as of 2025-08):
 *   Anthropic  — https://www.anthropic.com/pricing
 *   OpenAI     — https://openai.com/api/pricing
 *   Google     — https://ai.google.dev/pricing
 */
export interface ModelPricing {
  input:  number;   // $ per 1M input tokens
  output: number;   // $ per 1M output tokens
}

/** Providers whose models always cost zero (local inference). */
export const FREE_PROVIDERS = new Set(['ollama', 'lmstudio']);

const PRICING: Record<string, ModelPricing> = {
  // ── Anthropic ───────────────────────────────────────────────────────────────
  'claude-opus-4-6':                  { input: 15.00,  output: 75.00  },
  'claude-opus-4-5':                  { input: 15.00,  output: 75.00  },
  'claude-sonnet-4-6':                { input:  3.00,  output: 15.00  },
  'claude-sonnet-4-5':                { input:  3.00,  output: 15.00  },
  'claude-haiku-4-5':                 { input:  0.80,  output:  4.00  },
  'claude-haiku-4-5-20251001':        { input:  0.80,  output:  4.00  },
  'claude-3-5-sonnet-20241022':       { input:  3.00,  output: 15.00  },
  'claude-3-5-sonnet-20240620':       { input:  3.00,  output: 15.00  },
  'claude-3-5-haiku-20241022':        { input:  0.80,  output:  4.00  },
  'claude-3-opus-20240229':           { input: 15.00,  output: 75.00  },
  'claude-3-sonnet-20240229':         { input:  3.00,  output: 15.00  },
  'claude-3-haiku-20240307':          { input:  0.25,  output:  1.25  },

  // ── OpenAI ──────────────────────────────────────────────────────────────────
  'gpt-4.1':                          { input:  2.00,  output:  8.00  },
  'gpt-4.1-mini':                     { input:  0.40,  output:  1.60  },
  'gpt-4.1-nano':                     { input:  0.10,  output:  0.40  },
  'gpt-4o':                           { input:  2.50,  output: 10.00  },
  'gpt-4o-mini':                      { input:  0.15,  output:  0.60  },
  'gpt-4-turbo':                      { input: 10.00,  output: 30.00  },
  'gpt-4':                            { input: 30.00,  output: 60.00  },
  'gpt-3.5-turbo':                    { input:  0.50,  output:  1.50  },
  'o1':                               { input: 15.00,  output: 60.00  },
  'o1-mini':                          { input:  3.00,  output: 12.00  },
  'o1-preview':                       { input: 15.00,  output: 60.00  },
  'o3':                               { input: 10.00,  output: 40.00  },
  'o3-mini':                          { input:  1.10,  output:  4.40  },
  'o4-mini':                          { input:  1.10,  output:  4.40  },

  // ── Google Gemini ───────────────────────────────────────────────────────────
  // Pricing for prompts ≤200K tokens; above that tier is higher
  'gemini-2.5-pro':                   { input:  1.25,  output: 10.00  },
  'gemini-2.5-pro-preview':           { input:  1.25,  output: 10.00  },
  'gemini-2.5-pro-preview-05-06':     { input:  1.25,  output: 10.00  },
  'gemini-2.5-flash':                 { input:  0.075, output:  0.30  },
  'gemini-2.5-flash-preview':         { input:  0.075, output:  0.30  },
  'gemini-2.5-flash-preview-04-17':   { input:  0.075, output:  0.30  },
  'gemini-2.0-flash':                 { input:  0.10,  output:  0.40  },
  'gemini-2.0-flash-lite':            { input:  0.075, output:  0.30  },
  'gemini-2.0-flash-exp':             { input:  0.00,  output:  0.00  }, // free during preview
  'gemini-1.5-pro':                   { input:  1.25,  output:  5.00  },
  'gemini-1.5-pro-002':               { input:  1.25,  output:  5.00  },
  'gemini-1.5-flash':                 { input:  0.075, output:  0.30  },
  'gemini-1.5-flash-002':             { input:  0.075, output:  0.30  },
  'gemini-1.5-flash-8b':              { input:  0.0375, output: 0.15  },
};

/** Return pricing for a model, or `null` if the model is not in the pricing table. */
export function getKnownPricing(model: string): ModelPricing | null {
  return PRICING[model] ?? null;
}

/** True if we have confirmed pricing data for this model. */
export function isKnownPricing(model: string): boolean {
  return model in PRICING;
}

/**
 * Return pricing for a model.
 * - Local providers (ollama, lmstudio) always get zero cost.
 * - Unknown cloud models fall back to a rough estimate so telemetry
 *   still shows *something* rather than $0 silently.
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
