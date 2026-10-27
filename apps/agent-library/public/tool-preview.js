/**
 * Exactly what the agent will be handed, and what it will have to look for.
 *
 * The runner builds an agent's tool list from three places: its own core
 * tools, which every agent gets; the agent's own servers, with the everyday
 * board tools beside them; and the team's servers with the rest of the board.
 * The people tools join the agent's own side only on a runner with face
 * recognition set up, which the library cannot see, so they are shown apart. The editor decides only part of that, so this shows
 * the whole of it, in the order the runner sends it — the interesting question
 * is not "what did I tick" but "what will the model see".
 *
 * The split matters. A tool sent upfront costs its schema on every single
 * request; a tool left for `search_tools` costs a round trip and the risk of a
 * query that misses it. Neither is free, and the balance is only legible when
 * both sides are counted.
 */

import { $, clear, el, makeClient } from '/ui-kit/hats-ui.js';
import { splitForPreview, toolTokens } from '/upfront-model.js';

const api = makeClient('/api/v1');

/** The runner's own tools depend only on the hats, so each set is fetched once. */
const builtinByHats = new Map();

function builtinFor(hats = []) {
  const key = [...hats].sort().join(',');
  if (!builtinByHats.has(key)) {
    const query = hats.map((h) => `hat=${encodeURIComponent(h)}`).join('&');
    builtinByHats.set(key, api.get(`/builtin-tools?${query}`).catch((err) => {
      builtinByHats.delete(key);
      throw err;
    }));
  }
  return builtinByHats.get(key);
}

function toolRow(tool, upfront) {
  return el('label', { class: 'preview-tool', title: tool.description ?? '' },
    el('span', { class: `preview-dot ${upfront ? 'upfront' : 'searchable'}` }),
    el('code', {}, tool.name),
    el('span', { class: 'preview-server' }, tool.label),
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
 * @param {string[]} hats   the hats the agent wears, which decide its core tools
 */
export async function renderToolPreview(sources, upfrontTools, hats) {
  const host = $('#tool-preview');
  if (!host) return;

  let builtin;
  try {
    builtin = await builtinFor(hats);
  } catch (err) {
    clear(host);
    host.append(el('div', { class: 'preview-warn' }, `Could not list the runner's tools: ${err.message}`));
    return;
  }

  const { always, upfront, searchable, unknown } = splitForPreview(sources, upfrontTools, builtin);
  const sent = [...always, ...upfront];
  const cost = sent.reduce((sum, t) => sum + toolTokens(t), 0);
  clear(host);

  host.append(
    el('div', { class: 'preview-summary' },
      el('span', {}, `${sent.length} sent every call`),
      el('span', { class: 'muted' }, `≈${cost.toLocaleString()} tokens`),
      el('span', { class: 'muted' }, `· ${searchable.length} found on demand`),
    ),
    group('In every request', 'in the order the runner sends them', sent, true),
    group('Found with search_tools', 'costs a round trip when needed', searchable, false),
    group('Only with face recognition', "sent beside the agent's own servers when the runner has it set up",
      builtin.people.map((t) => ({ ...t, label: t.source })), false),
    el('div', { class: 'preview-empty' },
      'A paired phone adds its own tools (its camera, say) beside the agent\'s servers. '
      + "An MCP server's tools are listed once the Team Runner has connected to it."),
  );

  if (unknown.length) {
    // A selector that matches nothing is silent otherwise: the tool simply
    // never appears and nobody is told why.
    host.append(el('div', { class: 'preview-warn' },
      `Named but not found: ${unknown.join(', ')}. `
      + 'Either the server has not run yet, or the name is wrong.'));
  }
}
