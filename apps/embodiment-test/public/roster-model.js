/**
 * The roster, as data: two independent sources merged into one list.
 *
 * The Embodiment API only knows the agents the Team Runner has actually
 * deployed — the current project's team, and no more. The Agent Template Library knows
 * every agent that exists. Showing only the first makes the harness look broken
 * when a project has two members and the library has thirty; showing only the
 * second would prove nothing about the API.
 *
 * Every library template gets a row, keyed by its own id, so two agents that
 * happen to share a name stay two agents. A deployed agent then claims the row
 * it was deployed from — by `templateId` when the runner reports one, and by
 * name otherwise, which is how the runner itself resolves a name to an
 * instance. A deployed agent that matches nothing in the library keeps a row of
 * its own, because it is still real and still reachable.
 *
 * A row is `live` when the runner is running it — those are the ones you can
 * hold a conversation with. The rest are library rows: a face and a voice, but
 * nobody home.
 *
 * No imports and no DOM, so this is directly testable.
 */

const key = (name) => String(name ?? '').trim().toLowerCase();

/**
 * One roster entry. The key is stable whether or not the agent is deployed, so
 * a selection survives the agent being started or stopped underneath it.
 */
const makeRow = (template, live) => ({
  key: template ? `tpl:${template.id}` : `live:${live.id}`,
  name: (live ?? template).name,
  hats: (live ?? template).hats ?? [],
  identity: (live ?? template).identity ?? {},
  template: template ?? null,
  live: live ?? null,
});

/**
 * Merge a live Embodiment roster with the library's templates.
 *
 * @param {Array} live      agents from the Embodiment API (may be empty)
 * @param {Array} templates agent templates from the library (may be empty)
 * @returns {Array} rows, live agents first, then the rest alphabetically
 */
export function mergeRoster(live = [], templates = []) {
  const rows = templates.filter((t) => t?.name).map((t) => makeRow(t, null));

  /** The library row this instance was deployed from, if it can be identified. */
  const claim = (agent) =>
    (agent.templateId && rows.find((r) => r.template?.id === agent.templateId && !r.live))
    || rows.find((r) => key(r.name) === key(agent.name) && !r.live)
    || null;

  for (const agent of live) {
    if (!agent?.name) continue;
    const row = claim(agent);
    // A deployed agent is a copy of its template, so the running one wins on
    // every field — it is what the API will actually answer about.
    if (row) Object.assign(row, makeRow(row.template, agent));
    else rows.push(makeRow(null, agent));
  }

  return rows.sort((a, b) =>
    Number(Boolean(b.live)) - Number(Boolean(a.live)) || a.name.localeCompare(b.name));
}

/** Apply the search box and the "live only" toggle. */
export function filterRoster(rows, { search = '', liveOnly = false } = {}) {
  const needle = search.trim().toLowerCase();
  return rows.filter((row) => {
    if (liveOnly && !row.live) return false;
    if (!needle) return true;
    return `${row.name} ${row.identity.specialisation ?? ''} ${row.hats.join(' ')}`
      .toLowerCase().includes(needle);
  });
}

/** The line under the name: what it is doing, or what it is. */
export function subtitleFor(row) {
  if (row.live) return row.live.activity || row.live.state;
  return row.identity.specialisation || 'in the library, not deployed';
}
