import { describe, it, expect } from 'vitest';
import {
  extractionPrompt, htmlToText, mergePricing, parseExtraction, MAX_PAGE_CHARS, type PricingFile,
} from './pricing-extract.js';

describe('reading the extraction answer', () => {
  it('keeps well-formed prices', () => {
    expect(parseExtraction('Here you go: {"claude-opus-5-5": {"input": 4, "output": 20}}', 'end_turn'))
      .toEqual({ 'claude-opus-5-5': { input: 4, output: 20 } });
  });

  it('drops entries whose prices are not numbers', () => {
    expect(parseExtraction(JSON.stringify({
      good: { input: 0.1, output: 0.5 },
      text: { input: '$2', output: 10 },
      negative: { input: -1, output: 1 },
      missing: { input: 1 },
    }), 'end_turn')).toEqual({ good: { input: 0.1, output: 0.5 } });
  });

  it('fails on an answer that was cut off, rather than finding nothing', () => {
    expect(() => parseExtraction('{"a": {"input": 1, "output": 2}, "b": {"inp', 'max_tokens'))
      .toThrow(/cut off/);
  });

  it('fails on an answer that is not JSON', () => {
    expect(() => parseExtraction('No pricing here.', 'end_turn')).toThrow(/no JSON/);
    expect(() => parseExtraction('{not json}', 'end_turn')).toThrow(/not valid JSON/);
  });
});

describe('the extraction request', () => {
  it('names the ids the provider serves, so display names map onto them', () => {
    const prompt = extractionPrompt('Anthropic', 'Claude Opus 5.5 $4 / MTok', ['claude-opus-5-5', 'claude-haiku-5-5']);
    expect(prompt).toContain('claude-opus-5-5\nclaude-haiku-5-5');
    expect(prompt).toContain('use that exact id');
  });

  it('sends a long page whole, up to the limit', () => {
    expect(htmlToText(`<p>${'x'.repeat(120_000)}</p>`)).toHaveLength(120_000);
    expect(htmlToText(`<p>${'x'.repeat(MAX_PAGE_CHARS + 10)}</p>`)).toHaveLength(MAX_PAGE_CHARS);
  });
});

describe('merging into the pricing file', () => {
  it('counts what was added, changed and left alone', () => {
    const file: PricingFile = { updatedAt: '', models: {
      same:    { provider: 'openai', input: 1, output: 2 },
      changed: { provider: 'openai', input: 1, output: 2 },
    } };
    const counts = mergePricing(file, 'openai', {
      same: { input: 1, output: 2 }, changed: { input: 2, output: 4 }, fresh: { input: 3, output: 6 },
    });
    expect(counts).toEqual({ added: 1, updated: 1, unchanged: 1 });
    expect(file.models['fresh']).toEqual({ provider: 'openai', input: 3, output: 6 });
    expect(file.models['changed']).toEqual({ provider: 'openai', input: 2, output: 4 });
  });
});
