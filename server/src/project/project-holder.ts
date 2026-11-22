/**
 * Whether another runner has a project open.
 *
 * With a runner manager, each project has its own runner. A runner that is
 * not locked can still switch projects, and switching onto one another runner
 * holds would have two runners writing the same team state and board. So
 * before switching it asks the manager, passing on the caller's sign-in.
 */

/** What the manager lists for each project; only the fields read here. */
interface ProjectRow {
  id: string;
  runner: { port: number; status: 'running' | 'starting' | 'stopped' | 'unreachable' } | null;
}

export interface HolderCheck {
  managerUrl: string;
  /** This runner's port, so its own entry is never counted against it. */
  ownPort: number;
  /** The caller's sign-in, which the manager needs to list runners. */
  credential: string | null;
  fetchImpl?: typeof fetch;
}

/**
 * Why `project` cannot be opened here, or null when nothing else holds it.
 * A runner that is starting or not answering still counts: either may be
 * writing, or start writing again. When the manager cannot be asked, the
 * switch is refused rather than risked.
 */
export async function switchRefusal(project: string, o: HolderCheck): Promise<string | null> {
  const fetchImpl = o.fetchImpl ?? fetch;
  let rows: ProjectRow[];
  try {
    const res = await fetchImpl(`${o.managerUrl}/api/v1/runners`, {
      headers: o.credential ? { Authorization: `Bearer ${o.credential}` } : {},
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(String(res.status));
    rows = ((await res.json()) as { projects: ProjectRow[] }).projects;
  } catch {
    return 'Could not check with the runner manager whether another runner has this project open, so the switch was not made.';
  }

  const wanted = project.toLowerCase();
  const runner = rows.find((r) => r.id.toLowerCase() === wanted)?.runner;
  if (!runner || runner.status === 'stopped' || runner.port === o.ownPort) return null;
  const state = runner.status === 'unreachable' ? ', not answering at the moment' : '';
  return `${project} is open on another runner, on port ${runner.port}${state}. Open it there instead.`;
}
