import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';

export interface PricingEntry {
  provider: string;
  input: number;
  output: number;
}

export interface PricingFile {
  updatedAt: string;
  models: Record<string, PricingEntry>;
}

export interface UpdateResult {
  added: number;
  updated: number;
  unchanged: number;
  errors: string[];
}

const PRICING_FILE = join(process.cwd(), 'data', 'model-pricing.json');

// Pricing page URLs match each provider's pricingPageUrl property
const PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic',    url: 'https://platform.claude.com/docs/en/about-claude/pricing' },
  { id: 'openai',    name: 'OpenAI',       url: 'https://developers.openai.com/api/docs/pricing' },
  { id: 'gemini',    name: 'Google Gemini', url: 'https://ai.google.dev/gemini-api/docs/pricing' },
];

function loadExisting(): PricingFile {
  try {
    return JSON.parse(readFileSync(PRICING_FILE, 'utf-8')) as PricingFile;
  } catch {
    return { updatedAt: '', models: {} };
  }
}

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HATS-pricing-updater/1.0)' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function htmlToText(html: string): string {
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
    .slice(0, 50_000);
}

async function extractPricing(
  client: Anthropic,
  providerName: string,
  html: string,
): Promise<Record<string, { input: number; output: number }>> {
  const text = htmlToText(html);
  if (text.length < 500) throw new Error('Page content too short — likely a JS-rendered SPA; no pricing extracted');

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: `Extract all AI model text-token pricing from this ${providerName} pricing page.

Return ONLY a valid JSON object: model-id → {"input": <USD/1M tokens>, "output": <USD/1M tokens>}.
Rules:
- Values are USD per 1 million tokens (not per 1K).
- Only include text / language model pricing — skip image, audio, embedding, and fine-tuning.
- Use the exact model ID strings shown on the page (e.g. "claude-3-5-sonnet-20241022").
- If no pricing data is present, return {}.

Page content:
${text}`,
    }],
  });

  const raw = msg.content[0].type === 'text' ? msg.content[0].text.trim() : '';
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try {
    return JSON.parse(match[0]) as Record<string, { input: number; output: number }>;
  } catch {
    return {};
  }
}

export async function updatePricing(
  log: (msg: string) => void = console.log,
): Promise<UpdateResult> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY environment variable is required');

  const client = new Anthropic({ apiKey });
  const file   = loadExisting();
  const result: UpdateResult = { added: 0, updated: 0, unchanged: 0, errors: [] };

  for (const provider of PROVIDERS) {
    log(`[${provider.name}] Fetching pricing page…`);
    let html: string;
    try {
      html = await fetchPage(provider.url);
    } catch (err) {
      const msg = `${provider.name}: fetch failed — ${(err as Error).message}`;
      log(msg); result.errors.push(msg); continue;
    }

    log(`[${provider.name}] Extracting pricing with Claude Haiku…`);
    let extracted: Record<string, { input: number; output: number }>;
    try {
      extracted = await extractPricing(client, provider.name, html);
    } catch (err) {
      const msg = `${provider.name}: extraction failed — ${(err as Error).message}`;
      log(msg); result.errors.push(msg); continue;
    }

    const count = Object.keys(extracted).length;
    log(`[${provider.name}] Found ${count} model(s)`);

    for (const [model, prices] of Object.entries(extracted)) {
      const existing = file.models[model];
      if (existing) {
        if (existing.input !== prices.input || existing.output !== prices.output) {
          file.models[model] = { ...existing, input: prices.input, output: prices.output };
          result.updated++;
        } else {
          result.unchanged++;
        }
      } else {
        file.models[model] = { provider: provider.id, input: prices.input, output: prices.output };
        result.added++;
      }
    }
  }

  file.updatedAt = new Date().toISOString();

  const dir = join(process.cwd(), 'data');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(PRICING_FILE, JSON.stringify(file, null, 2), 'utf-8');
  log(`Saved — ${Object.keys(file.models).length} total models in model-pricing.json`);

  return result;
}

// ── CLI entry point ────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename || process.argv[1]?.endsWith('pricing-updater.ts')) {
  updatePricing()
    .then(r => {
      console.log(`\nDone: +${r.added} added  ~${r.updated} updated  =${r.unchanged} unchanged`);
      if (r.errors.length) console.log(`Errors:\n  ${r.errors.join('\n  ')}`);
    })
    .catch(err => { console.error('Fatal:', (err as Error).message); process.exit(1); });
}
