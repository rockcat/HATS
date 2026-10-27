/**
 * A checkbox list of MCP servers, grouped by category.
 *
 * Shared because the same question is asked in two places: the Project Designer
 * asks which servers the *team* runs, and the Agent Template Library asks which of them
 * one agent may use. Both were free-text boxes at some point, which meant
 * guessing at ids that had to match exactly — so both now pick from the
 * catalogue the runner will actually read.
 *
 * Pair it with `server-picker.css`.
 */

import { $$, el } from '/ui-kit/hats-ui.js';

/**
 * Render the picker into `container`.
 *
 * @param {HTMLElement} container
 * @param {Array} servers   catalogue entries: {id, name, description?, category?, envVars?, url?}
 * @param {object} [options]
 * @param {string[]} [options.selected]  ids to tick
 * @param {string}   [options.name]      checkbox group name, for reading back
 * @param {boolean}  [options.detail]    show descriptions and env-var badges
 * @param {(ids: string[]) => void} [options.onChange]
 */
export function buildServerPicker(container, servers, options = {}) {
  const { selected = [], name = 'mcpServer', detail = false, onChange } = options;
  const chosen = new Set(selected);

  const byCategory = new Map();
  for (const server of servers) {
    const key = server.category ?? 'other';
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push(server);
  }

  container.replaceChildren(...[...byCategory].flatMap(([category, list]) => [
    el('div', { class: 'server-group' }, category),
    ...list.map((server) => option(server, name, chosen.has(server.id), detail)),
  ]));

  if (onChange) {
    container.addEventListener('change', () => onChange(selectedServers(container, name)));
  }
}

function option(server, name, checked, detail) {
  const label = el('label', { class: `server-option${detail ? ' detailed' : ''}`, title: server.id },
    el('input', { type: 'checkbox', name, value: server.id, checked }),
    el('span', { class: 'server-text' },
      el('span', { class: 'server-name' },
        server.name ?? server.id,
        ...envBadges(server),
      ),
      detail && server.description ? el('span', { class: 'server-desc' }, server.description) : null,
    ),
  );
  return label;
}

/**
 * Which of the server's environment variables this machine actually has set.
 * A server whose key is missing will start and then fail, so it is worth
 * seeing before the project is saved rather than in the runner's log.
 */
function envBadges(server) {
  return (server.envVars ?? [])
    .filter((v) => v.present !== undefined)
    .map((v) => el('span', {
      class: `env-badge ${v.present ? 'present' : 'missing'}`,
      title: v.present ? `${v.name} is set` : `${v.name} is not set — ${v.placeholder ?? 'required'}`,
    }, v.name));
}

/** The ticked ids, in catalogue order. */
export function selectedServers(root, name = 'mcpServer') {
  return $$(`input[name="${name}"]:checked`, root).map((input) => input.value);
}

/** Tick exactly these ids, leaving the rest clear. */
export function setSelectedServers(root, ids, name = 'mcpServer') {
  const chosen = new Set(ids ?? []);
  for (const input of $$(`input[name="${name}"]`, root)) input.checked = chosen.has(input.value);
}
