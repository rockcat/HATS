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

/** Roughly what a tool costs in a request when its schema is not known. */
const TOKENS_PER_TOOL = 55;

/** Tokens a tool adds to every request it is sent in: its schema at ~4 characters a token. */
export function toolTokens(tool) {
  if (!tool.parameters) return TOKENS_PER_TOOL;
  const { name, description, parameters } = tool;
  return Math.ceil(JSON.stringify({ name, description, parameters }).length / 4);
}

/**
 * Exactly what the model will be sent, and what it will have to search for.
 *
 * Mirrors the runner: `getToolsForHat` first, always; then `splitToolSet`
 * over the agent's own servers plus the everyday board tools against the
 * team's servers plus the rest of the board. Same selector forms too: an
 * absent list means everything on the personal side, an empty one means
 * none, and a selector can name a whole server, one tool, the namespaced name
 * search results print, or a bare tool name.
 *
 * Note what follows from that, because the runner does it: once a template
 * picks its upfront tools, the everyday board tools are sent only if picked
 * too.
 *
 * `unknown` catches a selector that matches nothing, which is otherwise
 * silent — the tool simply never appears and nobody is told why.
 *
 * @param {Array} sources  catalogue entries this agent can draw on
 * @param {string[]|undefined} upfrontTools  the template's choice
 * @param {{core?: Array, onDemand?: Array, personal?: Array, shared?: Array}} builtin
 *   the runner's own tools, from /api/v1/builtin-tools
 */
export function splitForPreview(sources = [], upfrontTools, builtin = {}) {
  const mcp = (scope) => sources.filter((s) => (s.scope === 'personal') === (scope === 'personal'))
    .flatMap((server) => (server.knownTools ?? []).map((tool) => ({
      name: `mcp__${server.id}__${tool.name}`, bare: tool.name, description: tool.description,
      server: server.id, label: server.id, scope,
    })));
  const runner = (tools = [], scope) => tools.map((t) => ({ ...t, bare: t.name, server: '', label: t.source, scope }));

  const personal = [...mcp('personal'), ...runner(builtin.personal, 'personal')];
  const shared = [...mcp('team'), ...runner(builtin.shared, 'team')];
  const always = runner(builtin.core, 'runner');
  const onDemand = runner(builtin.onDemand, 'runner');

  // Absent means the default: everything on the agent's own side.
  if (upfrontTools === undefined) {
    return { always, upfront: personal, searchable: [...shared, ...onDemand], unknown: [] };
  }

  const chosen = new Set(upfrontTools.map((s) => s.trim().toLowerCase()).filter(Boolean));
  const matched = new Set();
  const isChosen = (tool) => {
    const server = tool.server.toLowerCase();
    const bare = tool.bare.toLowerCase();
    // Every form the runner honours. The editor only writes the first two,
    // but a hand-edited template may use either of the others — and this
    // panel exists for the person reading a hand-edited template.
    const forms = server ? [server, `${server}:${bare}`, `mcp__${server}__${bare}`, bare] : [bare];
    let hit = false;
    for (const form of forms) if (chosen.has(form)) { matched.add(form); hit = true; }
    return hit;
  };

  const all = [...personal, ...shared];
  const upfront = all.filter(isChosen);
  return {
    always,
    upfront,
    searchable: [...all.filter((t) => !upfront.includes(t)), ...onDemand],
    unknown: [...chosen].filter((c) => !matched.has(c)),
  };
}
