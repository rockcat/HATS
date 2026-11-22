import { describe, it, expect } from 'vitest';
import { LABELS, containerName, parseEnvFile, projectProblem, runnerSpec } from './runner-spec.js';

const spec = (over: Partial<Parameters<typeof runnerSpec>[0]> = {}) => runnerSpec({
  project: 'paige', port: 3101, image: 'ghcr.io/rockcat/hats-runner:latest',
  hostData: '/Users/me/hats/data/', network: 'hats_default',
  settings: { ANTHROPIC_API_KEY: 'k', TEAM_PROJECT: 'someone-else' },
  overrides: { AGENT_LIBRARY_URL: 'http://agent-library:3010' },
  ...over,
}) as {
  Env: string[]; Labels: Record<string, string>;
  HostConfig: { Binds: string[]; PortBindings: Record<string, Array<{ HostPort: string }>> };
  NetworkingConfig: { EndpointsConfig: Record<string, unknown> };
};
const envOf = (s: ReturnType<typeof spec>) =>
  Object.fromEntries(s.Env.map((e) => [e.slice(0, e.indexOf('=')), e.slice(e.indexOf('=') + 1)]));

describe('a launched runner', () => {
  it('is locked to its project, on its own port, the same inside and out', () => {
    const s = spec();
    expect(envOf(s)).toMatchObject({ TEAM_PROJECT: 'paige', HATS_PROJECT_LOCKED: '1', TEAM_RUNNER_PORT: '3101' });
    expect(s.HostConfig.PortBindings['3101/tcp']).toEqual([{ HostPort: '3101' }]);
  });

  it("keeps the installation's keys, but the manager decides its project and services", () => {
    const env = envOf(spec());
    expect(env['ANTHROPIC_API_KEY']).toBe('k');
    expect(env['TEAM_PROJECT']).toBe('paige');
    expect(env['AGENT_LIBRARY_URL']).toBe('http://agent-library:3010');
    expect(env['HATS_ENV_LOCKED']?.split(',')).toEqual(expect.arrayContaining(['TEAM_PROJECT', 'AGENT_LIBRARY_URL']));
  });

  it('gets its own data folder, with its project and the avatars mounted from the shared one', () => {
    expect(spec().HostConfig.Binds).toEqual([
      '/Users/me/hats/data/runners/paige:/app/runtime_data',
      '/Users/me/hats/data/projects/paige:/app/runtime_data/projects/paige',
      '/Users/me/hats/data/avatars:/app/runtime_data/avatars',
    ]);
  });

  it("joins the services' network and is labelled as this manager's", () => {
    const s = spec();
    expect(Object.keys(s.NetworkingConfig.EndpointsConfig)).toEqual(['hats_default']);
    expect(s.Labels).toEqual({ [LABELS.managed]: '1', [LABELS.project]: 'paige', [LABELS.port]: '3101' });
  });
});

describe('project names', () => {
  it('become container names Docker accepts', () => {
    expect(containerName('saas startup')).toBe('hats-runner-saas-startup');
    expect(containerName('Rhoda')).toBe('hats-runner-rhoda');
  });
  it('cannot escape the data folder', () => {
    for (const bad of ['', '../x', 'a/b', 'c:d', '.hidden']) expect(projectProblem(bad), bad).not.toBeNull();
    expect(projectProblem('saas startup')).toBeNull();
  });
});

describe('reading .env', () => {
  it('takes keys and values, and skips comments and blanks', () => {
    expect(parseEnvFile('# keys\nA=1\n\nB="two words"\nexport C=3\n#D=4\nE=a=b\r\n'))
      .toEqual({ A: '1', B: 'two words', C: '3', E: 'a=b' });
  });
});
