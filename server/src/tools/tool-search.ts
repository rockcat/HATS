/**
 * Tool discovery for agents.
 *
 * Most tools are not sent to the model on every call — there can be hundreds
 * once MCP servers are attached — so the model finds them with `search_tools`
 * and loads one with `get_tool`. That makes this the only route to most of an
 * agent's capabilities, and a miss here reads to the agent as "I cannot do
 * that".
 *
 * The query is therefore matched per word rather than as one string. An agent
 * asks for "read an email", not "email"; matching the whole phrase as a
 * substring found nothing, and the agent reported it had no way to read its
 * mail while `get_email` sat in the registry unfound.
 */

import { ToolDefinition } from '../providers/types.js';

export type ToolRegistry = Map<string, ToolDefinition>;

const MAX_RESULTS = 25;

/** Words that carry no signal in a tool query and would match almost anything. */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'my', 'me', 'i', 'it', 'its', 'to', 'of', 'in', 'on', 'for',
  'from', 'with', 'by', 'and', 'or', 'is', 'are', 'be', 'can', 'how', 'do',
  'does', 'that', 'this', 'any', 'all', 'some', 'tool', 'tools',
]);

export function buildToolRegistry(tools: ToolDefinition[]): ToolRegistry {
  return new Map(tools.map(t => [t.name, t]));
}

/** `mcp__email-imap__get_email` → `email-imap`; a built-in tool has no server. */
export function serverOf(toolName: string): string | null {
  const match = /^mcp__(.+?)__/.exec(toolName);
  return match?.[1] ?? null;
}

/** The bare tool name, without the MCP namespace prefix. */
function bareName(toolName: string): string {
  return toolName.replace(/^mcp__.+?__/, '');
}

/**
 * Normalise a word for comparison: lower case, and singular where a naive
 * plural is obvious. "emails" and "email" must find the same tools.
 *
 * Only the endings where `es` is really the plural marker are stripped whole —
 * taking it off "messages" leaves "messag", which no longer matches "message".
 */
function stem(word: string): string {
  const lower = word.toLowerCase();
  if (lower.length > 4 && lower.endsWith('ies')) return `${lower.slice(0, -3)}y`;
  if (lower.length > 4 && /(s|x|z|ch|sh)es$/.test(lower)) return lower.slice(0, -2);
  if (lower.length > 3 && lower.endsWith('s') && !lower.endsWith('ss')) return lower.slice(0, -1);
  return lower;
}

/** Split text into stemmed words. Tool names use `_`, prose uses spaces. */
function words(text: string): string[] {
  return text.split(/[^a-zA-Z0-9]+/).filter(Boolean).map(stem);
}

/**
 * How well one tool answers one query word.
 * A hit in the name is worth far more than a hit in the prose, and a whole-word
 * hit more than a fragment, so `get_email` beats `analyze_email_for_scheduling`
 * for "email".
 */
function scoreWord(word: string, name: string[], server: string[], description: string[]): number {
  if (name.includes(word)) return 10;
  if (server.includes(word)) return 6;
  if (description.includes(word)) return 4;
  // Fragments, so "attach" still finds "attachment" and "sched" finds "schedule".
  if (name.some(w => w.startsWith(word) || word.startsWith(w))) return 3;
  if (description.some(w => w.startsWith(word))) return 1;
  return 0;
}

interface Scored { tool: ToolDefinition; score: number; matched: number }

function rank(query: string, registry: ToolRegistry): Scored[] {
  const terms = [...new Set(words(query))].filter(w => !STOP_WORDS.has(w));
  // A query of nothing but stop words still means "show me something".
  if (terms.length === 0) return [...registry.values()].map(tool => ({ tool, score: 1, matched: 1 }));

  const scored: Scored[] = [];
  for (const tool of registry.values()) {
    const name = words(bareName(tool.name));
    const server = words(serverOf(tool.name) ?? '');
    const description = words(tool.description);

    let score = 0;
    let matched = 0;
    for (const term of terms) {
      const termScore = scoreWord(term, name, server, description);
      if (termScore > 0) { score += termScore; matched++; }
    }
    if (matched > 0) {
      // Matching more of the query is worth more than matching one word loudly,
      // so "read email" prefers a tool hitting both words.
      scored.push({ tool, score: score * matched, matched });
    }
  }

  return scored.sort((a, b) =>
    b.matched - a.matched || b.score - a.score || a.tool.name.localeCompare(b.tool.name));
}

const describe = (tool: ToolDefinition) => {
  const server = serverOf(tool.name);
  return { name: tool.name, description: tool.description, ...(server && { server }) };
};

export function searchTools(query: string, registry: ToolRegistry): string {
  const matches = rank(query ?? '', registry);

  if (matches.length === 0) {
    // Saying only "nothing matched" invites the agent to conclude the
    // capability does not exist. Naming what is connected lets it try again
    // with a word that will work.
    const servers = [...new Set([...registry.values()].map(t => serverOf(t.name)).filter(Boolean))];
    return JSON.stringify({
      results: [],
      message: 'No tools matched that query. Try a single keyword rather than a phrase.',
      ...(servers.length && { availableServers: servers }),
      toolCount: registry.size,
    });
  }

  const shown = matches.slice(0, MAX_RESULTS);
  return JSON.stringify({
    results: shown.map(m => describe(m.tool)),
    ...(matches.length > shown.length && {
      truncated: true,
      message: `Showing the ${shown.length} best of ${matches.length} matches — narrow the query for the rest.`,
    }),
  });
}

export interface GetToolResult {
  found: boolean;
  schema?: ToolDefinition;
  result: string;
}

export function getTool(name: string, registry: ToolRegistry): GetToolResult {
  const tool = registry.get(name);
  if (tool) return { found: true, schema: tool, result: JSON.stringify(tool) };

  // An agent that half-remembers a name should not be sent back to square one:
  // resolve an unambiguous bare name, and otherwise suggest the near misses.
  const wanted = bareName(name ?? '').toLowerCase();
  const candidates = [...registry.values()].filter(t => bareName(t.name).toLowerCase() === wanted);
  if (candidates.length === 1) {
    const only = candidates[0] as ToolDefinition;
    return { found: true, schema: only, result: JSON.stringify(only) };
  }

  const suggestions = (candidates.length ? candidates : rank(name ?? '', registry).slice(0, 5).map(m => m.tool))
    .map(t => t.name);
  return {
    found: false,
    result: JSON.stringify({
      error: `Tool "${name}" not found.`,
      ...(suggestions.length && { didYouMean: suggestions }),
      hint: 'Use search_tools to discover available tools.',
    }),
  };
}
