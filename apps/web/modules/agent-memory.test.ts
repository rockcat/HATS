import { describe, it, expect } from 'vitest';
// @ts-expect-error — a browser module; it imports only pure helpers, so it loads here.
import { renderAgentMemory } from './agent-memory.js';

/** Stands in for the panel element: all the renderer touches is innerHTML. */
const panel = () => ({ innerHTML: '' });

const graph = {
  entities: [
    { name: 'Paul', entityType: 'person', observations: ['Prefers ES modules', 'Works on HATS'] },
    { name: 'HATS', entityType: 'project', observations: ['Multi-agent system'] },
  ],
  relations: [{ from: 'Paul', to: 'HATS', relationType: 'works on' }],
};

describe('rendering what an agent remembers', () => {
  it('shows every entity and its observations', () => {
    const el = panel();
    renderAgentMemory(el, graph, { agentName: 'Poppy' });

    expect(el.innerHTML).toContain('Paul');
    expect(el.innerHTML).toContain('Prefers ES modules');
    expect(el.innerHTML).toContain('Works on HATS');
    expect(el.innerHTML).toContain('Multi-agent system');
  });

  it('counts things, observations and links', () => {
    const el = panel();
    renderAgentMemory(el, graph, { agentName: 'Poppy' });

    expect(el.innerHTML).toContain('2 things');
    expect(el.innerHTML).toContain('3 observations');
    expect(el.innerHTML).toContain('1 link');
  });

  it('shows a relation on both ends, pointing the right way', () => {
    const el = panel();
    renderAgentMemory(el, graph);

    // Once leaving Paul, once arriving at HATS.
    expect(el.innerHTML.split('→').length - 1).toBe(1);
    expect(el.innerHTML.split('←').length - 1).toBe(1);
  });

  it('says plainly when there is no memory server, naming the fix', () => {
    const el = panel();
    renderAgentMemory(el, null, { agentName: 'Rhoda' });

    expect(el.innerHTML).toContain('Rhoda');
    expect(el.innerHTML).toContain('no memory server');
    expect(el.innerHTML).toContain('memory');
  });

  it('distinguishes an empty memory from a missing one', () => {
    const el = panel();
    renderAgentMemory(el, { entities: [], relations: [] }, { agentName: 'Poppy' });

    expect(el.innerHTML).toContain('Nothing remembered yet');
    expect(el.innerHTML).not.toContain('no memory server');
  });

  it('shows an unexpected shape raw rather than dropping it', () => {
    // A memory you cannot see is worse than an ugly one.
    const el = panel();
    renderAgentMemory(el, { surprise: 'from a newer server' });

    expect(el.innerHTML).toContain('memory-raw');
    expect(el.innerHTML).toContain('from a newer server');
  });

  it('escapes what the agent wrote', () => {
    // The graph is agent-written text landing in the dashboard's innerHTML.
    const el = panel();
    renderAgentMemory(el, {
      entities: [{ name: '<img src=x onerror=alert(1)>', entityType: 'person', observations: ['</div><script>'] }],
      relations: [],
    });

    expect(el.innerHTML).not.toContain('<img');
    expect(el.innerHTML).not.toContain('<script>');
    expect(el.innerHTML).toContain('&lt;img');
  });

  it('survives an entity with no observations or type', () => {
    const el = panel();
    renderAgentMemory(el, { entities: [{ name: 'Half a thought' }], relations: [] });

    expect(el.innerHTML).toContain('Half a thought');
    expect(el.innerHTML).toContain('Nothing recorded about this yet');
  });

  it('does nothing without somewhere to render', () => {
    expect(() => renderAgentMemory(null, graph)).not.toThrow();
  });
});
