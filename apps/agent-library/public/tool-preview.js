/**
 * What the agent will actually be handed, and what it will have to look for.
 *
 * The editor decides this in two places that do not obviously add up: which
 * servers the agent may reach, and which of their tools go in front of the
 * model. This shows the result of both together, because the interesting
 * question is not "what did I tick" but "what will the model see".
 *
 * The split matters. A tool sent upfront costs its schema on every single
 * request; a tool left for `search_tools` costs a round trip and the risk of a
 * query that misses it. Neither is free, and the balance is only legible when
 * both sides are counted.
 */

import { $, clear, el } from '/ui-kit/hats-ui.js';
import { splitForPreview } from '/upfront-model.js';

/** Roughly what one tool schema costs in a request, for a sense of scale. */
const TOKENS_PER_TOOL = 55;

function toolRow(tool, upfront) {
  return el('label', { class: 'preview-tool', title: tool.description ?? '' },
    el('span', { class: `preview-dot ${upfront ? 'upfront' : 'searchable'}` }),
    el('code', {}, tool.name),
    el('span', { class: 'preview-server' }, tool.server),
  );
}

function group(title, note, tools, upfront) {
  return el('div', { class: 'preview-group' },
    el('div', { class: 'preview-group-head' },
      el('strong', {}, title),
      el('span', { class: 'tag' }, String(tools.length)),
      el('span', { class: 'preview-note' }, note),
    ),
    tools.length
      ? el('div', { class: 'preview-tools' }, ...tools.map((t) => toolRow(t, upfront)))
      : el('div', { class: 'preview-empty' }, 'Nothing.'),
  );
}

/**
 * Paint the panel.
 *
 * @param {Array} sources   catalogue entries this agent can draw on
 * @param {string[]|undefined} upfrontTools  the template's choice
 */
export function renderToolPreview(sources, upfrontTools) {
  const host = $('#tool-preview');
  if (!host) return;

  const { upfront, searchable, unknown } = splitForPreview(sources, upfrontTools);
  clear(host);

  if (upfront.length === 0 && searchable.length === 0) {
    host.append(el('div', { class: 'preview-empty' },
      'No MCP servers configured, so the agent has only its built-in tools.'));
    return;
  }

  const cost = upfront.length * TOKENS_PER_TOOL;
  host.append(
    el('div', { class: 'preview-summary' },
      el('span', {}, `${upfront.length} sent every call`),
      el('span', { class: 'muted' }, `≈${cost.toLocaleString()} tokens`),
      el('span', { class: 'muted' }, `· ${searchable.length} found on demand`),
    ),
    group('In the prompt', 'sent with every request', upfront, true),
    group('Found with search_tools', 'costs a round trip when needed', searchable, false),
  );

  if (unknown.length) {
    // A selector that matches nothing is silent otherwise: the tool simply
    // never appears and nobody is told why.
    host.append(el('div', { class: 'preview-warn' },
      `Named but not found: ${unknown.join(', ')}. `
      + 'Either the server has not run yet, or the name is wrong.'));
  }
}
