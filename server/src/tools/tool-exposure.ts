/**
 * Deciding which of an agent's MCP tools the model sees without asking.
 *
 * Every tool an agent can reach is either **upfront** — in the tool list of
 * every call — or **searchable**, found with `search_tools` and loaded with
 * `get_tool`. The two are a straight trade: upfront costs a schema in every
 * request, searchable costs a round trip and the risk of a query that misses.
 *
 * The default is every personal server upfront, because an agent given its own
 * mailbox should not have to discover it. But a personal server can be large —
 * the IMAP one alone offers 49 tools, of which an assistant uses perhaps five —
 * so a template can name exactly what it wants upfront.
 */

import type { ToolDefinition } from '../providers/types.js';
import { serverOf } from './tool-search.js';

/** Tools split by how the model gets at them. */
export interface AgentToolSet {
  /** Sent to the model in every call. */
  upfront: ToolDefinition[];
  /** Reachable through `search_tools` / `get_tool`. */
  searchable: ToolDefinition[];
}

/** Every MCP tool an agent can reach, by where the server came from. */
export interface AvailableTools {
  /** Servers configured for this agent alone, with its own credentials. */
  personal: ToolDefinition[];
  /** Servers the whole team runs. */
  shared: ToolDefinition[];
}

/** `mcp__email-imap__get_email` → `get_email`. */
function bareName(toolName: string): string {
  return toolName.replace(/^mcp__.+?__/, '');
}

/**
 * Does `selector` name this tool?
 *
 * Accepted forms, in the order somebody is likely to write them:
 *   `email-imap`                    the whole server
 *   `email-imap:get_email`          one tool
 *   `mcp__email-imap__get_email`    the name search results print
 */
function matches(selector: string, tool: ToolDefinition): boolean {
  const wanted = selector.trim().toLowerCase();
  if (!wanted) return false;

  const server = (serverOf(tool.name) ?? '').toLowerCase();
  const bare = bareName(tool.name).toLowerCase();

  if (wanted === tool.name.toLowerCase()) return true;
  if (wanted === server) return true;

  const colon = wanted.indexOf(':');
  if (colon > 0) {
    return wanted.slice(0, colon) === server && wanted.slice(colon + 1) === bare;
  }
  // A bare tool name is allowed when it is unambiguous; the caller checks that.
  return wanted === bare;
}

/**
 * Split the tools an agent can reach.
 *
 * `selectors` is the template's `tools.upfrontTools`. Undefined keeps the
 * default — every personal server upfront — so an agent that nobody has tuned
 * still finds its own mailbox.
 */
export function splitToolSet(available: AvailableTools, selectors?: string[]): AgentToolSet {
  const { personal, shared } = available;
  // A personal server wins a name clash: it is this agent's own account.
  const personalNames = new Set(personal.map((t) => t.name));
  const all = [...personal, ...shared.filter((t) => !personalNames.has(t.name))];

  if (selectors === undefined) {
    return { upfront: personal, searchable: all.filter((t) => !personalNames.has(t.name)) };
  }

  const chosen = new Set<string>();
  for (const tool of all) {
    if (selectors.some((selector) => matches(selector, tool))) chosen.add(tool.name);
  }

  return {
    upfront: all.filter((t) => chosen.has(t.name)),
    searchable: all.filter((t) => !chosen.has(t.name)),
  };
}

/**
 * Selectors that name nothing the agent can reach.
 *
 * A typo here is silent — the tool simply never appears — so the runner logs
 * these at startup rather than leaving an operator to wonder.
 */
export function unmatchedSelectors(available: AvailableTools, selectors?: string[]): string[] {
  if (!selectors?.length) return [];
  const all = [...available.personal, ...available.shared];
  return selectors.filter((selector) => !all.some((tool) => matches(selector, tool)));
}
