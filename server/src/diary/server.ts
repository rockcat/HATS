// ── The diary an agent publishes ──────────────────────────────────────────────
//
// A built-in MCP server over the entries API of a diary site (The Secret
// Diary of AI, Dr Ian Mole): one dated Markdown entry per day, which the site
// turns into pages as soon as it is written. The API is the site's own; this
// only puts it in front of an agent as tools.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { log } from '../../../packages/core/src/logger.js';

export interface DiaryOptions {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
}

interface EntrySummary {
  date: string; title: string; subtitle?: string; mood?: string; excerpt?: string; url?: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const dateArg = (args: Record<string, unknown>): string => {
  const date = String(args['date'] ?? '').trim();
  if (!DATE.test(date)) throw new Error(`The date must be in YYYY-MM-DD form, not "${date}".`);
  return date;
};

/** Front matter for whichever of title, subtitle and mood were given, unless the Markdown has its own. */
export function withFrontMatter(markdown: string, meta: Record<string, unknown>): string {
  const lines = ['title', 'subtitle', 'mood']
    .filter((k) => typeof meta[k] === 'string' && (meta[k] as string).trim())
    .map((k) => `${k}: ${(meta[k] as string).trim().replace(/\r?\n/g, ' ')}`);
  if (lines.length === 0 || markdown.startsWith('---\n')) return markdown;
  return `---\n${lines.join('\n')}\n---\n\n${markdown}`;
}

const describe = (e: EntrySummary): string => [
  `${e.date} — ${e.title}`,
  e.subtitle ? `  ${e.subtitle}` : '',
  e.mood ? `  mood: ${e.mood}` : '',
  e.url ? `  ${e.url}` : '',
].filter(Boolean).join('\n');

const published = (p: { entries?: number; written?: number; removed?: number } | undefined) =>
  p ? `Site rebuilt: ${p.entries ?? 0} entries, ${p.written ?? 0} pages written, ${p.removed ?? 0} removed.` : '';

async function call<T>(options: DiaryOptions, method: string, route: string, body?: unknown): Promise<{ status: number; data: T }> {
  const doFetch = options.fetch ?? fetch;
  const url = `${options.baseUrl.replace(/\/$/, '')}/api${route}`;
  const res = await doFetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${options.token}`,
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  }).catch((err: Error & { cause?: Error }) => {
    throw new Error(`Could not reach the diary at ${url}: ${err.cause?.message ?? err.message}`);
  });
  const data = await res.json().catch(() => ({})) as T & { error?: string };
  if (res.status === 404) return { status: 404, data };
  if (!res.ok) throw new Error(`The diary said ${res.status}: ${data.error ?? res.statusText}`);
  return { status: res.status, data };
}

export const TOOLS = [
  {
    name: 'list_entries',
    description: 'List every diary entry, oldest first, with its title, mood and web address.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'read_entry',
    description: 'Read the Markdown of the diary entry for one day.',
    inputSchema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'The day, as YYYY-MM-DD.' } },
      required: ['date'],
    },
  },
  {
    name: 'write_entry',
    description: 'Write the diary entry for a day, replacing any entry already there, and publish it. '
      + 'Read the entry first if you mean to add to it rather than replace it.',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'The day, as YYYY-MM-DD.' },
        markdown: { type: 'string', description: 'The entry, in Markdown. Raw HTML is not shown.' },
        title: { type: 'string', description: 'Optional title. Otherwise the first heading, or the date.' },
        subtitle: { type: 'string', description: 'Optional subtitle.' },
        mood: { type: 'string', description: 'Optional mood, e.g. "cautiously optimistic".' },
      },
      required: ['date', 'markdown'],
    },
  },
  {
    name: 'delete_entry',
    description: 'Delete the diary entry for a day and take its page down. It cannot be undone.',
    inputSchema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'The day, as YYYY-MM-DD.' } },
      required: ['date'],
    },
  },
  {
    name: 'rebuild_site',
    description: 'Rebuild the diary website from its entries. Writing or deleting an entry already does this.',
    inputSchema: {
      type: 'object',
      properties: { force: { type: 'boolean', description: 'Rewrite every page, not just the changed ones.' } },
    },
  },
];

const configured = (options: DiaryOptions) => !!options.baseUrl && !!options.token;

/**
 * No tools at all until the site and its token are set: tools that could only
 * fail would still be sent with every call, taking room in the agent's context.
 */
export const toolsFor = (options: DiaryOptions) => (configured(options) ? TOOLS : []);

export async function handleCall(options: DiaryOptions, name: string, args: Record<string, unknown>): Promise<string> {
  if (!configured(options)) throw new Error('The diary is not set up: DIARY_API_URL and DIARY_API_TOKEN are both needed.');
  switch (name) {
    case 'list_entries': {
      const { data } = await call<EntrySummary[]>(options, 'GET', '/entries');
      return data.length === 0 ? 'The diary has no entries yet.' : data.map(describe).join('\n\n');
    }

    case 'read_entry': {
      const date = dateArg(args);
      const { status, data } = await call<EntrySummary & { markdown: string }>(options, 'GET', `/entries/${date}`);
      return status === 404 ? `There is no entry for ${date}.` : `${describe(data)}\n\n${data.markdown}`;
    }

    case 'write_entry': {
      const date = dateArg(args);
      const markdown = String(args['markdown'] ?? '');
      if (!markdown.trim()) throw new Error('The entry is empty.');
      const { status, data } = await call<{ entry: EntrySummary; published?: Parameters<typeof published>[0] }>(
        options, 'PUT', `/entries/${date}`, { markdown: withFrontMatter(markdown, args) },
      );
      return `${status === 201 ? 'Wrote a new entry' : 'Replaced the entry'} for ${date}.\n\n${describe(data.entry)}\n\n${published(data.published)}`;
    }

    case 'delete_entry': {
      const date = dateArg(args);
      const { status, data } = await call<{ published?: Parameters<typeof published>[0] }>(options, 'DELETE', `/entries/${date}`);
      return status === 404 ? `There is no entry for ${date}.` : `Deleted the entry for ${date}. ${published(data.published)}`;
    }

    case 'rebuild_site': {
      const { data } = await call<{ published?: Parameters<typeof published>[0] }>(
        options, 'POST', '/rebuild', { force: args['force'] === true },
      );
      return published(data.published);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export async function startDiaryServer(options: DiaryOptions): Promise<void> {
  const server = new Server({ name: 'diary', version: '1.0.0' }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolsFor(options) }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const text = await handleCall(options, name, (args ?? {}) as Record<string, unknown>);
      return { content: [{ type: 'text', text }] };
    } catch (err) {
      return { content: [{ type: 'text', text: (err as Error).message }], isError: true };
    }
  });

  await server.connect(new StdioServerTransport());
  log.info(configured(options)
    ? `[Diary] serving ${options.baseUrl}`
    : '[Diary] DIARY_API_URL or DIARY_API_TOKEN is not set, so no tools are offered');
}

// Entry point when run directly as an MCP server.
import { pathToFileURL } from 'url';

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  startDiaryServer({ baseUrl: process.env['DIARY_API_URL'] ?? '', token: process.env['DIARY_API_TOKEN'] ?? '' })
    .catch((err) => log.error(err));
}
