/**
 * The team's shared MCP servers.
 *
 * The old team dashboard could turn these on and off; the Designer could not,
 * which left the project definition's `mcpServers` list editable only by hand.
 * Ticking a server here puts it in the definition, so the runner starts it for
 * the whole team the next time the project loads.
 *
 * The browser sends catalogue ids and never sees a transport config — the
 * Project Server expands them.
 */

import { $ } from '/ui-kit/hats-ui.js';
import { buildServerPicker, selectedServers, setSelectedServers } from '/ui-kit/server-picker.js';

let catalogue = [];

const ui = {
  section: $('#mcp-section'),
  picker:  $('#mcp-picker'),
  empty:   $('#mcp-empty'),
  count:   $('#mcp-count'),
  unknown: $('#mcp-unknown'),
};

/** Load the catalogue once. Returns the shared entries. */
export async function loadTeamMcpCatalogue(projects) {
  const result = await projects.get('/mcp/catalogue').catch(() => null);
  catalogue = result?.servers ?? [];
  return catalogue;
}

export function teamMcpCatalogue() { return catalogue; }

/**
 * The servers a project has enabled. The definition stores them as `{name,
 * config}` where `name` is the catalogue id — which is also what an agent's
 * `enabledMcpServers` refers to.
 */
export const enabledIds = (project) => (project?.mcpServers ?? []).map((s) => s.name);

/** Paint the picker for one project. `onChange` fires whenever a box is ticked. */
export function renderTeamMcp(project, onChange) {
  ui.section.hidden = !project;
  if (!project) return;

  ui.empty.hidden = catalogue.length > 0;
  ui.picker.hidden = catalogue.length === 0;

  buildServerPicker(ui.picker, catalogue, {
    selected: enabledIds(project),
    name: 'teamMcpServer',
    detail: true,
    onChange: () => { updateCount(); onChange?.(); },
  });
  showUnknown(project);
  updateCount();
}

/**
 * A definition can name a server the catalogue no longer has — edited by
 * hand, or carried over from another machine. It cannot be shown as a
 * checkbox and it will not survive the next save, so say so rather than
 * dropping it quietly.
 */
function showUnknown(project) {
  const known = new Set(catalogue.map((s) => s.id));
  const missing = enabledIds(project).filter((id) => !known.has(id));
  ui.unknown.hidden = missing.length === 0;
  ui.unknown.textContent = missing.length
    ? `Also configured, but not in the MCP catalogue: ${missing.join(', ')}. Saving will remove ${missing.length === 1 ? 'it' : 'them'}.`
    : '';
}

function updateCount() {
  ui.count.textContent = String(selected().length);
}

/** The ids currently ticked. */
export function selected() {
  return selectedServers(ui.picker, 'teamMcpServer');
}

/** Re-tick from a project, after a save round-trip. */
export function resetTo(project) {
  setSelectedServers(ui.picker, enabledIds(project), 'teamMcpServer');
  updateCount();
}
