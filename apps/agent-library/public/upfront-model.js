/**
 * Which tools an agent could be given, and how a selection is written down.
 *
 * No imports and no DOM, so this is directly testable; `upfront-tools.js` is
 * the part that draws it.
 */

/**
 * The catalogue entries this agent can draw tools from.
 *
 * Its own servers come first because they are the ones most likely to be worth
 * sending every time. A team server the agent's allow-list excludes is left
 * out — offering a tool the agent cannot reach would be a trap.
 *
 * @param {{personal: Array, shared: Array}} catalogue
 * @param {string[]} configuredPersonal  personal server ids this agent has set up
 * @param {string[]|undefined} enabledShared  team allow-list; undefined means all
 */
export function toolSources(catalogue, configuredPersonal = [], enabledShared) {
  const configured = new Set(configuredPersonal);
  const personal = (catalogue?.personal ?? []).filter((e) => configured.has(e.id));
  const shared = (catalogue?.shared ?? [])
    .filter((e) => enabledShared === undefined || enabledShared.includes(e.id));
  return [
    ...personal.map((e) => ({ ...e, scope: 'personal' })),
    ...shared.map((e) => ({ ...e, scope: 'team' })),
  ];
}

/** Is this tool covered by the current selection, whole-server or individually? */
export function isSelected(selected, serverId, toolName) {
  const chosen = selected instanceof Set ? selected : new Set((selected ?? []).map((s) => s.toLowerCase()));
  return chosen.has(serverId.toLowerCase()) || chosen.has(`${serverId}:${toolName}`.toLowerCase());
}

/**
 * Combine ticked servers and ticked tools into the stored list.
 *
 * A tool under a ticked server is already covered, so listing both would be
 * noise that drifts as the server's tool list changes.
 */
export function combineSelection(servers = [], tools = []) {
  const covered = new Set(servers.map((s) => s.toLowerCase()));
  const serverOf = (entry) => entry.slice(0, entry.indexOf(':')).toLowerCase();
  return [...servers, ...tools.filter((t) => !covered.has(serverOf(t)))];
}
