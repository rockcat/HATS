/**
 * Where each provider's prices come from and how they are read.
 *
 * Every provider publishes a markdown twin of its pricing page, which is far
 * cleaner than tag-stripped HTML. OpenAI's tables are keyed by API id, so they
 * are parsed directly. Anthropic and Gemini name models for people ("Claude
 * Opus 5.5"), so their markdown goes to the extraction model to map onto ids.
 */
import type { Extracted } from './pricing-extract.js';
import { OPENAI_PRICING_MARKDOWN_URL, parseOpenAiPricing } from './pricing-openai.js';

export interface PricingSource {
  id: string;
  name: string;
  /** The human-readable page; matches the provider's pricingPageUrl. Used if the markdown cannot be fetched. */
  url: string;
  /** The page as markdown. */
  markdownUrl: string;
  /** Reads prices without a model. When absent, or it finds nothing, the extraction model is used. */
  parse?: (markdown: string, knownIds: string[]) => Extracted;
}

export const PRICING_SOURCES: PricingSource[] = [
  {
    id: 'anthropic', name: 'Anthropic',
    url: 'https://platform.claude.com/docs/en/about-claude/pricing',
    markdownUrl: 'https://platform.claude.com/docs/en/about-claude/pricing.md',
  },
  {
    id: 'openai', name: 'OpenAI',
    url: 'https://developers.openai.com/api/docs/pricing',
    markdownUrl: OPENAI_PRICING_MARKDOWN_URL,
    parse: parseOpenAiPricing,
  },
  {
    id: 'gemini', name: 'Google Gemini',
    url: 'https://ai.google.dev/gemini-api/docs/pricing',
    markdownUrl: 'https://ai.google.dev/gemini-api/docs/pricing.md.txt',
  },
];
