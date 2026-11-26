/**
 * The team an agent means, as the Project Server knows it.
 *
 * discover_teams lists a team as `Insights (insights)`: its name, then its
 * id. An agent may pass either, in any case. The Project Server only knows
 * ids, so a name is turned into the id here; anything unknown is passed on
 * unchanged, for the Project Server to refuse with its own reason.
 */
export function resolveTeam(asked: string, projects: Array<{ id: string; name: string }>): string {
  const wanted = asked.trim();
  const lower = wanted.toLowerCase();
  const exact = projects.find((p) => p.id === wanted);
  if (exact) return exact.id;
  const match = projects.find((p) => p.id.toLowerCase() === lower)
    ?? projects.find((p) => p.name.trim().toLowerCase() === lower);
  return match?.id ?? wanted;
}
