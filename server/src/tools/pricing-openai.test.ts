import { describe, it, expect } from 'vitest';
import { parseOpenAiPricing, parseModelId, parsePrice } from './pricing-openai.js';
import { parseMarkdownTables } from './markdown-tables.js';

// Trimmed from developers.openai.com/api/docs/pricing.md, keeping the shapes that matter.
const PAGE = `# Pricing

Flagship models

Standard

### Standard pricing data

| Model | Short context input | Short context output | Short context cached input | Long context input | Long context output |
| --- | --- | --- | --- | --- | --- |
| gpt-6-sol | $2.00 | $10.00 | $0.20 | $4.00 | $15.00 |
| gpt-5.5 (<272K context length) | $5.00 | $30.00 | $0.50 | $10.00 | $45.00 |

| Model | Input | Output | Cached input |
| --- | --- | --- | --- |
| gpt-4.1 | $2.00 | $8.00 | $0.50 |
| o3-pro | $20.00 | $80.00 | - |

Batch

### Batch pricing data

#### Batch

| Model | Input | Output | Cached input |
| --- | --- | --- | --- |
| gpt-4.1 | $1.00 | $4.00 | - |

| Model | Input | Output | Cached input |
| --- | --- | --- | --- |
| batch-only | $1.00 | $4.00 | - |

#### Flex

| Model | Input | Output | Cached input |
| --- | --- | --- | --- |
| flex-only | $1.00 | $4.00 | - |

Cyber models

### Standard pricing data

| Model | Short context input | Short context output |
| --- | --- | --- |
| gpt-6-cyber | $20.00 | $100.00 |
| gpt-6-sol | $99.00 | $99.00 |

Realtime and audio generation models

### Grouped Pricing Table data

| Model | Modality | Input | Output / cost | Cached input |
| --- | --- | --- | --- | --- |
| gpt-realtime-2 | Audio | $32.00 | $64.00 | $0.40 |
| gpt-realtime-2 | Text | $4.00 | $24.00 | $0.40 |
| gpt-realtime-2 | Image | $5.00 | - | $0.50 |

Specialized models

### Grouped Pricing Table data

| Category | Model | Input | Output | Cached input |
| --- | --- | --- | --- | --- |
| Codex | gpt-5.3-codex | $1.75 | $14.00 | $0.175 |
| Embedding | text-embedding-3-small | $0.02 | - | - |
| Moderation | omni-moderation-latest | Free | - | - |

Fine-tuning

Standard

### Pricing Table data

| Model | Training | Input | Output | Cached input |
| --- | --- | --- | --- | --- |
| gpt-4.1-2025-04-14 | $25.00 | $3.00 | $12.00 | $0.75 |
`;

describe('reading OpenAI pricing tables', () => {
  const prices = parseOpenAiPricing(PAGE);

  it('reads standard prices, short-context where there are tiers', () => {
    expect(prices['gpt-6-sol']).toEqual({ input: 2, output: 10 });
    expect(prices['gpt-4.1']).toEqual({ input: 2, output: 8 });
    expect(prices['o3-pro']).toEqual({ input: 20, output: 80 });
  });

  it('strips notes from model names', () => {
    expect(prices['gpt-5.5']).toEqual({ input: 5, output: 30 });
  });

  it('skips batch and flex tables, including follow-on tables in the same tab', () => {
    expect(prices['batch-only']).toBeUndefined();
    expect(prices['flex-only']).toBeUndefined();
  });

  it('reads a later section as standard again, keeping the first price seen', () => {
    expect(prices['gpt-6-cyber']).toEqual({ input: 20, output: 100 });
    expect(prices['gpt-6-sol']).toEqual({ input: 2, output: 10 });
  });

  it('takes the text row of a multimodal model', () => {
    expect(prices['gpt-realtime-2']).toEqual({ input: 4, output: 24 });
  });

  it('skips models with no output price, and fine-tuning', () => {
    expect(prices['gpt-5.3-codex']).toEqual({ input: 1.75, output: 14 });
    expect(prices['text-embedding-3-small']).toBeUndefined();
    expect(prices['omni-moderation-latest']).toBeUndefined();
    expect(prices['gpt-4.1-2025-04-14']).toBeUndefined();
  });

  it('prices served snapshot ids as their alias', () => {
    const withSnapshots = parseOpenAiPricing(PAGE, ['gpt-4.1-2025-04-14', 'gpt-9-2030-01-01']);
    expect(withSnapshots['gpt-4.1-2025-04-14']).toEqual({ input: 2, output: 8 });
    expect(withSnapshots['gpt-9-2030-01-01']).toBeUndefined();
  });

  it('finds nothing in a page with no tables', () => {
    expect(parseOpenAiPricing('<html>Pricing</html>')).toEqual({});
  });
});

describe('cells', () => {
  it('reads prices', () => {
    expect(parsePrice('$1.25')).toBe(1.25);
    expect(parsePrice('$0.0375')).toBe(0.0375);
    expect(parsePrice('$1,000.00')).toBe(1000);
    expect(parsePrice('-')).toBeNull();
    expect(parsePrice('Free')).toBeNull();
    expect(parsePrice('$0.006 / minute')).toBeNull();
  });

  it('reads model ids', () => {
    expect(parseModelId('gpt-5.4-pro (<272K context length)')).toBe('gpt-5.4-pro');
    expect(parseModelId('[gpt-4o](/models/gpt-4o)')).toBe('gpt-4o');
    expect(parseModelId('Web search')).toBeNull();
  });
});

describe('markdown tables', () => {
  it('keeps the text before each table', () => {
    const tables = parseMarkdownTables('intro\n\n| a | b |\n| :-- | --: |\n| 1 | 2 |\n\nBatch\n| a |\n| --- |\n| 3 |\n');
    expect(tables).toHaveLength(2);
    expect(tables[0]).toEqual({ headers: ['a', 'b'], rows: [['1', '2']], preceding: 'intro\n' });
    expect(tables[1]!.preceding).toContain('Batch');
  });
});
