import { describe, it, expect } from 'vitest';
import { catalogueRows, filterRows, nextSort, pricedButUnoffered, sortRows } from './model-catalogue.js';

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

describe('sorting the catalogue', () => {
  const sortable = [
    { provider: 'OpenAI',    model: 'b', free: false, price: { input: 2, output: 8 },  context: 128_000 },
    { provider: 'Anthropic', model: 'a', free: false, price: null,                     context: 1_000_000 },
    { provider: 'Ollama',    model: 'c', free: true,  price: null,                     context: null },
    { provider: 'Anthropic', model: 'd', free: false, price: { input: 5, output: 25 }, context: 200_000 },
  ];
  const models = (key: string, dir?: string) => sortRows(sortable, key, dir).map(r => r.model).join('');

  it('sorts by text columns', () => {
    expect(models('model')).toBe('abcd');
    expect(models('model', 'desc')).toBe('dcba');
    expect(models('provider')).toBe('adcb');
  });

  it('sorts prices with free as zero and unknown always last', () => {
    expect(models('input')).toBe('cbda');
    expect(models('input', 'desc')).toBe('dbca');
  });

  it('keeps models with no context size at the bottom either way', () => {
    expect(models('context')).toBe('bdac');
    expect(models('context', 'desc')).toBe('adbc');
  });

  it('flips the current column, and starts numbers high-first', () => {
    expect(nextSort({ key: 'model', dir: 'asc' }, 'model')).toEqual({ key: 'model', dir: 'desc' });
    expect(nextSort({ key: 'model', dir: 'asc' }, 'provider')).toEqual({ key: 'provider', dir: 'asc' });
    expect(nextSort({ key: 'model', dir: 'asc' }, 'context')).toEqual({ key: 'context', dir: 'desc' });
  });
});
