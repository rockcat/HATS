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

/**
 * What the model will be sent, and what it will have to search for.
 *
 * The same rule the runner applies, so the preview and the behaviour cannot
 * drift: an absent selector list means every tool from the agent's own
 * servers; an empty one means none. `unknown` catches a selector that matches
 * nothing, which is otherwise silent — the tool simply never appears.
 */
export function splitForPreview(sources = [], upfrontTools) {
  const all = [];
  for (const server of sources) {
    for (const tool of server.knownTools ?? []) {
      all.push({ name: tool.name, description: tool.description, server: server.id, scope: server.scope });
    }
  }

  // Absent means the default: everything from this agent's own servers.
  if (upfrontTools === undefined) {
    return {
      upfront: all.filter((t) => t.scope === 'personal'),
      searchable: all.filter((t) => t.scope !== 'personal'),
      unknown: [],
    };
  }

  const chosen = new Set(upfrontTools.map((s) => s.toLowerCase()));
  const matched = new Set();
  const isChosen = (tool) => {
    const whole = tool.server.toLowerCase();
    const exact = `${tool.server}:${tool.name}`.toLowerCase();
    if (chosen.has(whole)) { matched.add(whole); return true; }
    if (chosen.has(exact)) { matched.add(exact); return true; }
    return false;
  };

  const upfront = all.filter(isChosen);
  return {
    upfront,
    searchable: all.filter((t) => !upfront.includes(t)),
    unknown: [...chosen].filter((c) => !matched.has(c)),
  };
}
