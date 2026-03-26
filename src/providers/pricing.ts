/**
 * Per-model pricing in USD per 1M tokens.
 * Used for telemetry cost estimation.
 */
export interface ModelPricing {
  input:  number;   // $ per 1M input tokens
  output: number;   // $ per 1M output tokens
}

const PRICING: Record<string, ModelPricing> = {
  // ── Anthropic ──────────────────────────────────────────────────────────────
  'claude-opus-4-6':              { input: 15.00, output: 75.00 },
  'claude-sonnet-4-6':            { input:  3.00, output: 15.00 },
  'claude-haiku-4-5-20251001':    { input:  0.80, output:  4.00 },
  'claude-3-5-sonnet-20241022':   { input:  3.00, output: 15.00 },
  'claude-3-5-haiku-20241022':    { input:  0.80, output:  4.00 },
  'claude-3-opus-20240229':       { input: 15.00, output: 75.00 },

  // ── OpenAI ────────────────────────────────────────────────────────────────
  'gpt-4.1':                      { input:  2.00, output:  8.00 },
  'gpt-4.1-mini':                 { input:  0.40, output:  1.60 },
  'gpt-4o':                       { input:  2.50, output: 10.00 },
  'gpt-4o-mini':                  { input:  0.15, output:  0.60 },
  'o1':                           { input: 15.00, output: 60.00 },
  'o1-mini':                      { input:  3.00, output: 12.00 },
  'o3-mini':                      { input:  1.10, output:  4.40 },

  // ── Google Gemini ─────────────────────────────────────────────────────────
  'gemini-2.5-pro':               { input:  1.25, output: 10.00 },
  'gemini-2.5-flash':             { input:  0.075, output: 0.30 },
  'gemini-2.0-flash':             { input:  0.10, output:  0.40 },
  'gemini-1.5-pro':               { input:  1.25, output:  5.00 },
  'gemini-1.5-flash':             { input:  0.075, output: 0.30 },
};

/** Return pricing for a model, or a sensible default if unknown. */
export function getPricing(model: string): ModelPricing {
  return PRICING[model] ?? { input: 1.00, output: 3.00 };
}

/** Calculate cost in USD for a call. */
export function calcCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = getPricing(model);
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
}
