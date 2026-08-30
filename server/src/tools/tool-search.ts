import { ToolDefinition } from '../providers/types.js';

export type ToolRegistry = Map<string, ToolDefinition>;

export function buildToolRegistry(tools: ToolDefinition[]): ToolRegistry {
  return new Map(tools.map(t => [t.name, t]));
}

export function searchTools(query: string, registry: ToolRegistry): string {
  const q = query.toLowerCase();
  const matches = [...registry.values()].filter(
    t => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q),
  );
  if (matches.length === 0) {
    return JSON.stringify({ results: [], message: 'No tools matched that query.' });
  }
  return JSON.stringify({ results: matches.map(t => ({ name: t.name, description: t.description })) });
}

export interface GetToolResult {
  found: boolean;
  schema?: ToolDefinition;
  result: string;
}

export function getTool(name: string, registry: ToolRegistry): GetToolResult {
  const tool = registry.get(name);
  if (!tool) {
    return {
      found: false,
      result: JSON.stringify({ error: `Tool "${name}" not found. Use search_tools to discover available tools.` }),
    };
  }
  return { found: true, schema: tool, result: JSON.stringify(tool) };
}
