// ── What an agent remembers ───────────────────────────────────────────────────
//
// The memory server keeps a knowledge graph: entities with observations about
// them, and relations between them. It is the only part of an agent that is
// meant to outlive the conversation, so it is worth being able to look at —
// both to see what has stuck and to spot what has gone stale.
//
// Read live from the running server rather than off disk, because the graph
// sits in memory between writes and the file lags behind what the agent knows.

import { esc } from './utils.js';

/** Group a flat entity list so each one shows with its own observations. */
function entityCard(entity, relations) {
  const observations = entity.observations ?? [];
  const links = relations.filter((r) => r.from === entity.name || r.to === entity.name);

  return `
    <div class="memory-entity">
      <div class="memory-entity-head">
        <span class="memory-entity-name">${esc(entity.name)}</span>
        <span class="memory-entity-type">${esc(entity.entityType ?? 'thing')}</span>
        <span class="memory-count">${observations.length}</span>
      </div>
      ${observations.length
        ? `<ul class="memory-observations">${observations
            .map((o) => `<li>${esc(String(o))}</li>`).join('')}</ul>`
        : '<p class="memory-empty-line">Nothing recorded about this yet.</p>'}
      ${links.length
        ? `<div class="memory-relations">${links.map((r) => `
            <span class="memory-relation">
              ${esc(r.from === entity.name ? '→' : '←')}
              ${esc(r.from === entity.name ? r.to : r.from)}
              <em>${esc(r.relationType ?? 'related to')}</em>
            </span>`).join('')}</div>`
        : ''}
    </div>`;
}

/**
 * Render a graph into `el`.
 *
 * The shape comes from `@modelcontextprotocol/server-memory`: `{ entities,
 * relations }`. Anything else is shown raw rather than silently dropped — a
 * memory you cannot see is worse than an ugly one.
 */
export function renderAgentMemory(el, graph, { agentName } = {}) {
  if (!el) return;

  if (graph === null) {
    el.innerHTML = `<p class="memory-empty">
      ${esc(agentName ?? 'This agent')} has no memory server running, so there is nothing to show.
      Add <code>memory</code> to its personal MCP servers to give it one.
    </p>`;
    return;
  }

  const entities = Array.isArray(graph?.entities) ? graph.entities : null;
  if (!entities) {
    el.innerHTML = `<pre class="memory-raw">${esc(JSON.stringify(graph, null, 2))}</pre>`;
    return;
  }

  if (entities.length === 0) {
    el.innerHTML = `<p class="memory-empty">
      Nothing remembered yet. ${esc(agentName ?? 'This agent')} writes here as it learns things worth keeping.
    </p>`;
    return;
  }

  const relations = Array.isArray(graph.relations) ? graph.relations : [];
  const observations = entities.reduce((n, e) => n + (e.observations?.length ?? 0), 0);

  el.innerHTML = `
    <div class="memory-summary">
      ${entities.length} thing${entities.length === 1 ? '' : 's'} ·
      ${observations} observation${observations === 1 ? '' : 's'} ·
      ${relations.length} link${relations.length === 1 ? '' : 's'}
    </div>
    ${entities.map((e) => entityCard(e, relations)).join('')}`;
}

/** Fetch and show one agent's memory. */
export async function loadAgentMemory(agentName, el) {
  if (!el) return;
  el.innerHTML = '<p class="memory-empty">Reading…</p>';
  try {
    const res = await fetch(`/api/agents/${encodeURIComponent(agentName)}/memory`);
    const data = await res.json();
    if (!res.ok) {
      el.innerHTML = `<p class="memory-empty">${esc(data.error ?? `Failed (${res.status})`)}</p>`;
      return;
    }
    renderAgentMemory(el, data.memory ?? null, { agentName });
  } catch (err) {
    el.innerHTML = `<p class="memory-empty">Could not read memory: ${esc(String(err))}</p>`;
  }
}
