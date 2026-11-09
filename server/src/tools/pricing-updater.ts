import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { runtimeDir } from '../../../packages/core/src/runtime-dir.js';
import {
  extractionPrompt, htmlToText, mergePricing, parseExtraction, MAX_PAGE_CHARS,
  type Extracted, type PricingFile,
} from './pricing-extract.js';
import { PRICING_SOURCES, type PricingSource } from './pricing-sources.js';

export type { PricingEntry, PricingFile } from './pricing-extract.js';

export interface UpdateResult {
  added: number;
  updated: number;
  unchanged: number;
  errors: string[];
}

/** Model ids each provider's API serves, by provider id — the keys prices are looked up by. */
export type KnownModels = Record<string, string[]>;

// The file providers/pricing.ts reads. This wrote to <cwd>/data instead, so a
// refresh saved prices the runner never looked at.
const PRICING_FILE = runtimeDir('data', 'model-pricing.json');

const EXTRACTION_MODEL = 'claude-haiku-5-5';

function loadExisting(): PricingFile {
  try {
    return JSON.parse(readFileSync(PRICING_FILE, 'utf-8')) as PricingFile;
  } catch {
    return { updatedAt: '', models: {} };
  }
}

async function fetchPage(url: string): Promise<{ body: string; type: string }> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HATS-pricing-updater/1.0)' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { body: await res.text(), type: res.headers.get('content-type') ?? '' };
}

interface Page { text: string; markdown: boolean }

/** The markdown twin when it is served, else the HTML page as plain text. */
async function loadPage(source: PricingSource, log: (msg: string) => void): Promise<Page> {
  try {
    const { body, type } = await fetchPage(source.markdownUrl);
    if (!/html/i.test(type) && body.trim()) return { text: body.slice(0, MAX_PAGE_CHARS), markdown: true };
    log(`[${source.name}] Markdown page came back as ${type || 'unknown type'} — using the HTML page`);
  } catch (err) {
    log(`[${source.name}] Markdown page failed (${(err as Error).message}) — using the HTML page`);
  }
  const text = htmlToText((await fetchPage(source.url)).body);
  if (text.length < 500) throw new Error('Page content too short — likely a JS-rendered SPA; no pricing extracted');
  return { text, markdown: false };
}

async function extractWithModel(
  client: Anthropic,
  providerName: string,
  text: string,
  knownIds: string[],
): Promise<Extracted> {
  const msg = await client.messages.create({
    model: EXTRACTION_MODEL,
    max_tokens: 16_000,
    messages: [{ role: 'user', content: extractionPrompt(providerName, text, knownIds) }],
  });

  const raw = msg.content.map(b => (b.type === 'text' ? b.text : '')).join('').trim();
  return parseExtraction(raw, msg.stop_reason);
}

export async function updatePricing(
  log: (msg: string) => void = console.log,
  knownModels: KnownModels = {},
): Promise<UpdateResult> {
  let client: Anthropic | undefined;
  const getClient = (): Anthropic => {
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY environment variable is required');
    return (client ??= new Anthropic({ apiKey }));
  };

  const file   = loadExisting();
  const result: UpdateResult = { added: 0, updated: 0, unchanged: 0, errors: [] };

  for (const source of PRICING_SOURCES) {
    const knownIds = knownModels[source.id] ?? [];
    log(`[${source.name}] Fetching pricing page…`);
    let page: Page;
    try {
      page = await loadPage(source, log);
    } catch (err) {
      const msg = `${source.name}: fetch failed — ${(err as Error).message}`;
      log(msg); result.errors.push(msg); continue;
    }

    let extracted: Extracted = {};
    if (source.parse && page.markdown) {
      extracted = source.parse(page.text, knownIds);
      log(`[${source.name}] Read ${Object.keys(extracted).length} price(s) from the page's tables`);
      if (!Object.keys(extracted).length) log(`[${source.name}] Tables gave nothing — falling back to ${EXTRACTION_MODEL}`);
    }
    if (!Object.keys(extracted).length) {
      log(`[${source.name}] Extracting pricing with ${EXTRACTION_MODEL}…`);
      try {
        extracted = await extractWithModel(getClient(), source.name, page.text, knownIds);
      } catch (err) {
        const msg = `${source.name}: extraction failed — ${(err as Error).message}`;
        log(msg); result.errors.push(msg); continue;
      }
    }

    const count = Object.keys(extracted).length;
    log(`[${source.name}] Found ${count} model(s)`);
    if (count === 0) result.errors.push(`${source.name}: no prices found on the pricing page`);

    const counts = mergePricing(file, source.id, extracted);
    result.added += counts.added;
    result.updated += counts.updated;
    result.unchanged += counts.unchanged;
  }

  file.updatedAt = new Date().toISOString();

  const dir = dirname(PRICING_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(PRICING_FILE, JSON.stringify(file, null, 2), 'utf-8');
  log(`Saved — ${Object.keys(file.models).length} total models in model-pricing.json`);

  return result;
}

// ── CLI entry point ────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename || process.argv[1]?.endsWith('pricing-updater.ts')) {
  import('../api/providers.js')
    .then(({ KNOWN_PROVIDERS, getCachedModels }) => Promise.all(
      KNOWN_PROVIDERS.map(async p => [p.id, await getCachedModels(p).catch(() => [...p.models])] as const),
    ))
    .then(known => updatePricing(console.log, Object.fromEntries(known)))
    .then(r => {
      console.log(`\nDone: +${r.added} added  ~${r.updated} updated  =${r.unchanged} unchanged`);
      if (r.errors.length) console.log(`Errors:\n  ${r.errors.join('\n  ')}`);
    })
    .catch(err => { console.error('Fatal:', (err as Error).message); process.exit(1); });
}
