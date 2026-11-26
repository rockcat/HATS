import { describe, it, expect } from 'vitest';
import {
  fetchOpenAiContextWindows, fillSnapshots, openAiModelPageUrl, pagesToFetch, parseContextWindow,
} from './openai-context.js';

const PAGE = `# GPT-5.5

Model ID: \`gpt-5.5\`

## Model details

- Default snapshot: \`gpt-5.5-2026-04-23\`
- Input modalities: text, image
- 1,050,000 context window
- 128,000 max output tokens
`;

describe('OpenAI context windows', () => {
  it("reads the size from a model page's details", () => {
    expect(parseContextWindow(PAGE)).toBe(1_050_000);
    expect(parseContextWindow('- 400,000 token context window')).toBe(400_000);
    expect(parseContextWindow('# Pricing\n\nNo details here.')).toBeNull();
  });

  it('skips snapshot pages when the alias is fetched, and gives snapshots its size', () => {
    const ids = ['gpt-5.5', 'gpt-5.5-2026-04-23', 'gpt-4o-2024-08-06'];
    expect(pagesToFetch(ids)).toEqual(['gpt-5.5', 'gpt-4o-2024-08-06']);
    expect(fillSnapshots({ 'gpt-5.5': 10 }, ids)).toEqual({ 'gpt-5.5': 10, 'gpt-5.5-2026-04-23': 10 });
  });

  it('fetches each page, reporting ids no page sized', async () => {
    const pages: Record<string, string> = { [openAiModelPageUrl('gpt-5.5')]: PAGE };
    const result = await fetchOpenAiContextWindows(
      ['gpt-5.5', 'gpt-5.5-2026-04-23', 'gpt-gone'],
      async url => { if (!pages[url]) throw new Error('HTTP 404'); return pages[url]!; },
    );
    expect(result).toEqual({
      sizes: { 'gpt-5.5': 1_050_000, 'gpt-5.5-2026-04-23': 1_050_000 },
      missing: ['gpt-gone'],
    });
  });
});
