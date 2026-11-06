import { describe, it, expect } from 'vitest';
import { catalogueRows, filterRows, pricedButUnoffered } from './model-catalogue.js';

const providers = [
  { id: 'anthropic', label: 'Anthropic', available: true,  models: ['static-model'] },
  { id: 'ollama',    label: 'Ollama',    available: false, models: [] },
];
const live = [
  { id: 'anthropic', models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-opus-5-5'] },
  { id: 'ollama',    models: ['llama4'] },
];
const pricing = {
  pricing: { 'claude-opus-5-5': { input: 5, output: 25 }, 'retired-model': { input: 1, output: 2 } },
  freeProviders: ['ollama'],
  contextWindows: { 'claude-opus-5-5': 200_000 },
};

describe('the model catalogue', () => {
  const rows = catalogueRows(providers, live, pricing);

  it('lists each retrieved model once, sorted within its provider', () => {
    expect(rows.map(r => `${r.providerId}/${r.model}`)).toEqual([
      'anthropic/claude-opus-5-5', 'anthropic/claude-sonnet-5-5', 'ollama/llama4',
    ]);
  });

  it('gives each model its price and context window, or says it is unknown', () => {
    expect(rows[0]).toMatchObject({ price: { input: 5, output: 25 }, context: 200_000, free: false });
    expect(rows[1]).toMatchObject({ price: null, context: null, free: false });
  });

  it('marks local providers free', () => {
    expect(rows[2]).toMatchObject({ free: true, price: null, available: false });
  });

  it("falls back to a provider's static list when nothing was retrieved", () => {
    expect(catalogueRows(providers, [], pricing).map(r => r.model)).toEqual(['static-model']);
  });

  it('finds priced models no provider offers', () => {
    expect(pricedButUnoffered(rows, pricing.pricing).map(u => u.model)).toEqual(['retired-model']);
  });

  it('filters by model or provider', () => {
    expect(filterRows(rows, 'OPUS').map(r => r.model)).toEqual(['claude-opus-5-5']);
    expect(filterRows(rows, 'ollama').map(r => r.model)).toEqual(['llama4']);
    expect(filterRows(rows, ' ')).toHaveLength(3);
  });
});
