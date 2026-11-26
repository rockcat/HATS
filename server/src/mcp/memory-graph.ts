// ── The shape of what an agent remembers ──────────────────────────────────────
//
// `@modelcontextprotocol/server-memory` keeps a knowledge graph: entities with
// observations about them, and relations between them. It returns that graph
// the way every MCP tool returns everything — a JSON string inside a text
// content block — so it has to be unwrapped twice before anyone can look at it.

/** One thing an agent knows about. */
export interface MemoryEntity {
  name: string;
  entityType?: string;
  observations?: string[];
}

/** A link between two of them. */
export interface MemoryRelation {
  from: string;
  to: string;
  relationType?: string;
}

export interface MemoryGraph {
  entities: MemoryEntity[];
  relations: MemoryRelation[];
}

/** Is this the graph shape, rather than an error or something newer? */
export function isMemoryGraph(value: unknown): value is MemoryGraph {
  return (
    typeof value === 'object' && value !== null &&
    Array.isArray((value as MemoryGraph).entities)
  );
}

/**
 * Turn what `read_graph` returned into a graph.
 *
 * Returns `null` rather than throwing when the text is not a graph: an empty
 * reply, an error message, or a shape from a newer server. The caller can then
 * say "nothing to show" instead of breaking the panel it was asked to fill.
 */
export function parseMemoryGraph(text: string): MemoryGraph | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (!isMemoryGraph(parsed)) return null;
  return {
    entities: parsed.entities,
    relations: Array.isArray(parsed.relations) ? parsed.relations : [],
  };
}
