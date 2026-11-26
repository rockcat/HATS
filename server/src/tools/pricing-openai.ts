/**
 * OpenAI's pricing page, read without a model.
 *
 * The HTML page shows only a few "featured" rows per section; the rest load
 * from script. Its markdown twin (pricing.md) has every table, keyed by API
 * model id, so the standard-tier text prices are read straight from it.
 */
import { parseMarkdownTables, type MarkdownTable } from './markdown-tables.js';
import type { Extracted } from './pricing-extract.js';

export const OPENAI_PRICING_MARKDOWN_URL = 'https://developers.openai.com/api/docs/pricing.md';

/** Tab labels the page groups tables under. Only "standard" is the list price. */
const TIER = /^(standard|batch|flex|fast|ultrafast|priority)$/i;

/**
 * The tier a table belongs to: the last tab label before it, or "standard"
 * when a new section heading starts without one. A table directly following
 * another (no heading between) shares its tier.
 */
function tierOf(table: MarkdownTable, previous: string): string {
  const labels = table.preceding.split('\n')
    .map(l => l.replace(/^#+\s*/, '').trim())
    .filter(l => TIER.test(l));
  if (labels.length) return labels[labels.length - 1]!.toLowerCase();
  if (/^#{2,}\s/m.test(table.preceding)) return 'standard';
  return previous;
}

/** "$1.25" → 1.25; "-", "Free", "$0.006 / minute" → null. */
export function parsePrice(cell: string | undefined): number | null {
  const m = cell?.trim().match(/^\$\s*([\d,]*\.?\d+)$/);
  return m ? Number(m[1]!.replace(/,/g, '')) : null;
}

/** "gpt-5.5 (<272K context length)" → "gpt-5.5"; null when it is not an id. */
export function parseModelId(cell: string | undefined): string | null {
  const id = (cell ?? '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\([^)]*\)/g, '')
    .replace(/[`*]/g, '')
    .trim();
  return /^[a-z0-9][a-z0-9._-]*$/.test(id) ? id : null;
}

const col = (headers: string[], re: RegExp) => headers.findIndex(h => re.test(h));

function readTable(table: MarkdownTable, out: Extracted): void {
  const { headers } = table;
  if (col(headers, /^training$/i) >= 0) return;             // fine-tuning
  const model    = col(headers, /^model/i);
  const input    = col(headers, /^(short context )?input$/i);
  const output   = col(headers, /^(short context )?output\b/i);
  const modality = col(headers, /^modality$/i);
  if (model < 0 || input < 0 || output < 0) return;

  for (const row of table.rows) {
    if (modality >= 0 && row[modality]?.toLowerCase() !== 'text') continue;
    const id = parseModelId(row[model]);
    const inp = parsePrice(row[input]);
    const outp = parsePrice(row[output]);
    if (id && inp !== null && outp !== null && !(id in out)) out[id] = { input: inp, output: outp };
  }
}

/**
 * Snapshot ids the API serves ("gpt-4.1-2025-04-14") are priced as their
 * alias when the page lists only the alias.
 */
function addSnapshots(out: Extracted, knownIds: string[]): void {
  for (const id of knownIds) {
    if (id in out) continue;
    const base = id.match(/^(.+)-\d{4}-\d{2}-\d{2}$/)?.[1];
    if (base && out[base]) out[id] = { ...out[base] };
  }
}

export function parseOpenAiPricing(markdown: string, knownIds: string[] = []): Extracted {
  const out: Extracted = {};
  let tier = 'standard';
  for (const table of parseMarkdownTables(markdown)) {
    tier = tierOf(table, tier);
    if (tier === 'standard') readTable(table, out);
  }
  addSnapshots(out, knownIds);
  return out;
}
