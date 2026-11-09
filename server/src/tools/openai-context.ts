/**
 * OpenAI context windows, from each model's docs page.
 *
 * OpenAI's model list API gives ids only, and its compare page covers a
 * handful of flagships, but every model page's markdown twin has a line like
 * "- 1,050,000 context window".
 */

export const openAiModelPageUrl = (id: string): string =>
  `https://developers.openai.com/api/docs/models/${encodeURIComponent(id)}.md`;

/** "- 1,050,000 context window" → 1050000; null when the page does not say. */
export function parseContextWindow(markdown: string): number | null {
  const m = markdown.match(/^\s*[-*]\s*([\d,]+)\s+(?:token\s+)?context window/im);
  const n = m ? Number(m[1]!.replace(/,/g, '')) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

const SNAPSHOT = /^(.+)-\d{4}-\d{2}-\d{2}$/;

/** The ids whose pages are fetched: snapshots are left out when their alias is listed too. */
export function pagesToFetch(ids: string[]): string[] {
  const all = new Set(ids);
  return [...all].filter(id => !(SNAPSHOT.test(id) && all.has(id.match(SNAPSHOT)![1]!)));
}

/** Give snapshots their alias's size where their own page was not read. */
export function fillSnapshots(sizes: Record<string, number>, ids: string[]): Record<string, number> {
  const out = { ...sizes };
  for (const id of ids) {
    const base = id.match(SNAPSHOT)?.[1];
    if (!(id in out) && base && out[base]) out[id] = out[base];
  }
  return out;
}

export interface ContextFetchResult { sizes: Record<string, number>; missing: string[] }

/** Read the context window of each id from its model page, a few pages at a time. */
export async function fetchOpenAiContextWindows(
  ids: string[],
  fetchText: (url: string) => Promise<string>,
  concurrency = 6,
): Promise<ContextFetchResult> {
  const queue = pagesToFetch(ids);
  const sizes: Record<string, number> = {};
  const worker = async (): Promise<void> => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      try {
        const size = parseContextWindow(await fetchText(openAiModelPageUrl(id)));
        if (size) sizes[id] = size;
      } catch { /* no page for this id — reported as missing */ }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  const filled = fillSnapshots(sizes, ids);
  return { sizes: filled, missing: ids.filter(id => !(id in filled)).sort() };
}
