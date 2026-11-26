/**
 * The pure half of the pricing updater: what is asked of the model, how its
 * answer is read, and how the result is merged into model-pricing.json.
 */

export interface PricingEntry {
  provider: string;
  input: number;
  output: number;
}

export interface PricingFile {
  updatedAt: string;
  models: Record<string, PricingEntry>;
}

export type Extracted = Record<string, { input: number; output: number }>;

export interface MergeCounts { added: number; updated: number; unchanged: number }

/** Pages are sent whole up to this many characters; the Gemini page alone is ~100k. */
export const MAX_PAGE_CHARS = 200_000;

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_PAGE_CHARS);
}

/**
 * The extraction request.
 *
 * Pages name models for people ("Claude Opus 5.5"), but prices are looked up
 * by API id ("claude-opus-5-5"). Left to guess, the model invented ids that
 * matched nothing, so the ids the provider actually serves are given to it.
 */
export function extractionPrompt(providerName: string, text: string, knownIds: string[]): string {
  const ids = knownIds.length
    ? `\nThese are the model ids this provider's API serves. When a model on the page is one of them, use that exact id as the key:\n${knownIds.join('\n')}\nFor a model on the page that is not in this list, use the id the page shows, or omit it if the page gives no id.\n`
    : '\nUse the exact API model id strings shown on the page. Omit a model if the page gives no id for it.\n';
  return `Extract all AI model text-token pricing from this ${providerName} pricing page.

Return ONLY a valid JSON object: model-id → {"input": <USD per 1M input tokens>, "output": <USD per 1M output tokens>}.
Rules:
- Values are USD per 1 million tokens (not per 1K).
- Use the standard (non-batch, non-cached) price. Where a price depends on prompt length, use the lower tier. Where it changes on a date, use the price in effect now.
- Only include text / language model pricing — skip image, audio, embedding and fine-tuning.
- If no pricing data is present, return {}.
${ids}
Page content:
${text}`;
}

const isPrice = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;

/**
 * Read the model's answer. Throws rather than returning {} when the answer
 * was cut off or is not JSON — "found 0 models" hid both.
 */
export function parseExtraction(raw: string, stopReason: string | null | undefined): Extracted {
  if (stopReason === 'max_tokens') throw new Error('the answer was cut off before it finished');
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('the answer had no JSON in it');
  let parsed: unknown;
  try { parsed = JSON.parse(match[0]); } catch (err) { throw new Error(`the answer was not valid JSON: ${(err as Error).message}`); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('the answer was not a JSON object');

  const out: Extracted = {};
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    const v = value as { input?: unknown; output?: unknown } | null;
    const model = id.trim();
    if (model && v && isPrice(v.input) && isPrice(v.output)) out[model] = { input: v.input, output: v.output };
  }
  return out;
}

/** Fold one provider's prices into the file, counting what changed. */
export function mergePricing(file: PricingFile, providerId: string, extracted: Extracted): MergeCounts {
  const counts: MergeCounts = { added: 0, updated: 0, unchanged: 0 };
  for (const [model, prices] of Object.entries(extracted)) {
    const existing = file.models[model];
    if (!existing) {
      file.models[model] = { provider: providerId, ...prices };
      counts.added++;
    } else if (existing.input !== prices.input || existing.output !== prices.output) {
      file.models[model] = { ...existing, ...prices };
      counts.updated++;
    } else {
      counts.unchanged++;
    }
  }
  return counts;
}
