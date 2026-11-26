/**
 * An agent's tools as the Configure panel shows them, and back again.
 *
 * Each tool is a row: what it is, what it costs in every call, and whether
 * it is sent. The hat's own tools and the board's hot path are always sent;
 * the MCP tools can be ticked in or out. Ticked tools become the agent's
 * `upfrontTools` selectors, a whole server's name when all of it is ticked.
 */

import type { ToolDefinition } from '../providers/types.js';
import type { AgentToolSet, AvailableTools } from './tool-exposure.js';
import { serverOf } from './tool-search.js';

export type ToolKind = 'core' | 'always' | 'personal' | 'shared';

export interface ToolRow {
  name: string;
  /** The MCP server it comes from, or null for the runner's own. */
  server: string | null;
  description: string;
  /** Size of its schema as sent; ~4 characters a token. */
  chars: number;
  kind: ToolKind;
  /** In every call, rather than found with search_tools. */
  upfront: boolean;
  /** Whether the panel may change `upfront`. */
  selectable: boolean;
}

const size = (tool: ToolDefinition) => JSON.stringify(tool).length;

/** The rows, core tools first, then each server's tools together. */
export function toolRows(core: ToolDefinition[], available: AvailableTools, split: AgentToolSet): ToolRow[] {
  const sent = new Set(split.upfront.map((t) => t.name));
  const row = (tool: ToolDefinition, kind: ToolKind): ToolRow => ({
    name: tool.name,
    server: serverOf(tool.name),
    description: tool.description ?? '',
    chars: size(tool),
    kind,
    upfront: kind === 'core' || kind === 'always' || sent.has(tool.name),
    selectable: kind === 'personal' || kind === 'shared',
  });
  const personalNames = new Set(available.personal.map((t) => t.name));
  const selectable = [
    ...available.personal.map((t) => row(t, 'personal')),
    // A personal server wins a name clash, as it does in splitToolSet.
    ...available.shared.filter((t) => !personalNames.has(t.name)).map((t) => row(t, 'shared')),
  ].sort((a, b) => (a.server ?? '').localeCompare(b.server ?? '') || a.name.localeCompare(b.name));
  return [
    ...core.map((t) => row(t, 'core')),
    ...(available.always ?? []).map((t) => row(t, 'always')),
    ...selectable,
  ];
}

/** `mcp__email-imap__get_email` → `email-imap:get_email`; anything else as named. */
function selectorFor(name: string): string {
  const server = serverOf(name);
  return server ? `${server}:${name.slice(`mcp__${server}__`.length)}` : name;
}

/**
 * The selectors for the tools ticked. A server whose every tool is ticked is
 * named whole, so a tool it gains later is sent too.
 */
export function selectorsFor(rows: ToolRow[], ticked: string[]): string[] {
  const chosen = new Set(ticked);
  const selectable = rows.filter((r) => r.selectable);
  const byServer = new Map<string, ToolRow[]>();
  for (const r of selectable) {
    if (r.server) byServer.set(r.server, [...(byServer.get(r.server) ?? []), r]);
  }
  const whole = new Set([...byServer].filter(([, tools]) => tools.every((t) => chosen.has(t.name))).map(([s]) => s));
  return [
    ...whole,
    ...selectable
      .filter((r) => chosen.has(r.name) && !(r.server && whole.has(r.server)))
      .map((r) => selectorFor(r.name)),
  ];
}
