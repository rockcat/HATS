import { describe, it, expect } from 'vitest';
import { parseMemoryGraph, isMemoryGraph } from './memory-graph.js';

describe('reading back a memory graph', () => {
  it('parses what the memory server actually returns', () => {
    // A JSON string inside a text block — the shape every MCP tool replies in.
    const graph = parseMemoryGraph(JSON.stringify({
      entities: [{ name: 'Paul', entityType: 'person', observations: ['Prefers ES modules'] }],
      relations: [{ from: 'Paul', to: 'HATS', relationType: 'works on' }],
    }));

    expect(graph?.entities).toHaveLength(1);
    expect(graph?.entities[0]?.name).toBe('Paul');
    expect(graph?.relations[0]?.relationType).toBe('works on');
  });

  it('treats an empty graph as a graph, not as nothing', () => {
    // "Remembers nothing yet" and "has no memory server" are different facts,
    // and the panel says different things about them.
    const graph = parseMemoryGraph('{"entities":[],"relations":[]}');
    expect(graph).toEqual({ entities: [], relations: [] });
    expect(graph).not.toBeNull();
  });

  it('supplies relations the server left out', () => {
    expect(parseMemoryGraph('{"entities":[]}')?.relations).toEqual([]);
  });

  it('gives up quietly on an error message rather than throwing', () => {
    // A tool error arrives as prose in the same text block.
    expect(parseMemoryGraph('Error: no such file')).toBeNull();
  });

  it('gives up on an empty reply', () => {
    expect(parseMemoryGraph('')).toBeNull();
    expect(parseMemoryGraph('   ')).toBeNull();
  });

  it('gives up on valid JSON that is not a graph', () => {
    expect(parseMemoryGraph('{"content":[{"type":"text"}]}')).toBeNull();
    expect(parseMemoryGraph('[1,2,3]')).toBeNull();
    expect(parseMemoryGraph('null')).toBeNull();
  });

  it('recognises a graph by its entities', () => {
    expect(isMemoryGraph({ entities: [] })).toBe(true);
    expect(isMemoryGraph({ entities: 'none' })).toBe(false);
    expect(isMemoryGraph(null)).toBe(false);
  });
});
