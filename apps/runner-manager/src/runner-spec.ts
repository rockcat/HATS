// ── What a launched runner looks like ────────────────────────────────────────
//
// The same rules docs/MULTIPLE-PROJECTS.md sets for a hand-written runner:
// its own port, the same inside and out (Google sign-in returns to
// localhost:<port>); one project, locked; its own data folder, since logins,
// tokens and the MCP catalogue are written by every runner; and its project's
// folder mounted from the shared one, so nothing is copied. The shared
// avatars are mounted too, so it can assign them without its own copy.

/** Where a runner keeps everything, inside its container. */
const RUNNER_DATA = '/app/runtime_data';

/** Labels that mark a container as one of this manager's runners. */
export const LABELS = {
  managed: 'hats.runner.managed',
  project: 'hats.runner.project',
  port: 'hats.runner.port',
} as const;

export interface RunnerSpecInput {
  project: string;
  port: number;
  image: string;
  /** The shared data folder's path on the host, which Docker binds from. */
  hostData: string;
  /** The compose network the services are on, so service names resolve. */
  network: string;
  /** The installation's settings (its .env), passed on as they are. */
  settings: Record<string, string>;
  /** Fixed by the manager: service addresses and the like. They win over settings. */
  overrides: Record<string, string>;
}

/** A name Docker accepts for the container, from any project id. */
export function containerName(project: string): string {
  return `hats-runner-${project.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '')}`;
}

/** Why `project` cannot be a folder name, or null if it can. */
export function projectProblem(project: string): string | null {
  if (!project.trim()) return 'A project is required.';
  if (/[/\\:]|\.\./.test(project) || project.startsWith('.')) return 'A project name cannot contain / \\ : or start with a dot.';
  return null;
}

/** The body of Docker's POST /containers/create. Pure. */
export function runnerSpec(input: RunnerSpecInput): Record<string, unknown> {
  const { project, port, image, hostData, network } = input;
  const data = hostData.replace(/[/\\]+$/, '');
  const env: Record<string, string> = {
    ...input.settings,
    ...input.overrides,
    NODE_ENV: 'production',
    RUNTIME_DIR: RUNNER_DATA,
    TEAM_PROJECT: project,
    HATS_PROJECT_LOCKED: '1',
    TEAM_RUNNER_PORT: String(port),
  };
  // A runner's Settings page must not move it off its project or its services.
  env['HATS_ENV_LOCKED'] = [
    'RUNTIME_DIR', 'TEAM_PROJECT', 'HATS_PROJECT_LOCKED', 'TEAM_RUNNER_PORT',
    ...Object.keys(input.overrides),
  ].join(',');

  return {
    Image: image,
    Env: Object.entries(env).map(([k, v]) => `${k}=${v}`),
    Labels: { [LABELS.managed]: '1', [LABELS.project]: project, [LABELS.port]: String(port) },
    ExposedPorts: { [`${port}/tcp`]: {} },
    HostConfig: {
      PortBindings: { [`${port}/tcp`]: [{ HostPort: String(port) }] },
      Binds: [
        `${data}/runners/${project}:${RUNNER_DATA}`,
        `${data}/projects/${project}:${RUNNER_DATA}/projects/${project}`,
        `${data}/avatars:${RUNNER_DATA}/avatars`,
      ],
      RestartPolicy: { Name: 'unless-stopped' },
      ExtraHosts: ['host.docker.internal:host-gateway'],
    },
    NetworkingConfig: { EndpointsConfig: { [network]: {} } },
  };
}

/** KEY=value lines of a .env file. Comments, blanks and quotes handled; no expansion. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).replace(/^export\s+/, '').trim();
    let value = line.slice(eq + 1).trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}
