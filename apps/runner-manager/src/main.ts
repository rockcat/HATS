/**
 * HATS runner manager.
 *
 * Knows every team runner, so the dashboard's project switcher can open the
 * runner for another project, and starts a runner for a project that has
 * none. Several runners share one set of services: this one, the auth
 * service, the Agent Template Library, the Project Server and Speech.
 *
 * Launching needs the Docker socket mounted. Without it the manager still
 * lists runners; it just cannot start them.
 *
 * Start it with `npm run runner-manager`.
 */

import { existsSync } from 'fs';
import { metaRoutes, runnerGate, runnerToken, startService } from '@hats/service-kit/index';
import { runtimeDir } from '@hats/core/runtime-dir';
import { remoteAuthenticator } from '@hats/auth/authenticator';
import { Docker } from './docker.js';
import { Registry } from './registry.js';
import { RunnerManager } from './manager.js';
import { runnerRoutes } from './routes.js';

const env = process.env;
const [portFrom, portTo] = (env['RUNNER_PORTS'] ?? '3101-3199').split('-').map(Number);

const config = {
  name: 'RunnerManager',
  version: '1.0.0',
  port: Number(env['RUNNER_MANAGER_PORT'] ?? 3080),
  socket: env['DOCKER_SOCKET'] ?? '/var/run/docker.sock',
  image: env['RUNNER_IMAGE'] ?? 'ghcr.io/rockcat/hats-runner:latest',
  projectServerUrl: env['PROJECT_SERVER_URL'] ?? 'http://localhost:3020',
  authServiceUrl: env['AUTH_SERVICE_URL'] || null,
} as const;

/**
 * What every launched runner is told, whatever the .env says: where the
 * services are, and where to report in. Taken from this service's own
 * settings, which compose gives it.
 */
const OVERRIDE_KEYS = [
  'AGENT_LIBRARY_URL', 'PROJECT_SERVER_URL', 'SPEECH_SERVICE_URL', 'AUTH_SERVICE_URL',
  'RUNNER_MANAGER_URL', 'OLLAMA_BASE_URL', 'LM_STUDIO_BASE_URL',
];

async function listProjects(): Promise<Array<{ id: string; name: string }>> {
  const res = await fetch(`${config.projectServerUrl.replace(/\/$/, '')}/api/v1/projects`, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) return [];
  const body = await res.json() as { projects?: Array<{ id: string; name?: string }> };
  return (body.projects ?? []).map((p) => ({ id: p.id, name: p.name ?? p.id }));
}

async function main(): Promise<void> {
  const registry = new Registry();
  const manager = new RunnerManager({
    docker: new Docker(config.socket),
    registry,
    selfId: env['HOSTNAME'] ?? '',
    dataDir: runtimeDir(),
    image: config.image,
    ports: { from: portFrom ?? 3101, to: portTo ?? 3199 },
    envFile: env['HATS_ENV_FILE'] || null,
    overrides: Object.fromEntries(OVERRIDE_KEYS.flatMap((k) => (env[k] ? [[k, env[k]!]] : []))),
    listProjects,
  });

  if (!config.authServiceUrl) {
    console.warn(`[${config.name}] no AUTH_SERVICE_URL: nobody can be signed in, so runners are not listed or started`);
  }

  await startService({
    name: config.name,
    port: config.port,
    routes: [
      ...metaRoutes({
        base: '/api/v1',
        health: () => ({ service: 'runner-manager', version: config.version, docker: existsSync(config.socket) }),
      }),
      ...runnerRoutes({
        manager,
        registry,
        auth: config.authServiceUrl ? remoteAuthenticator(config.authServiceUrl) : null,
        canLaunch: () => existsSync(config.socket),
        isRunner: runnerGate(runnerToken()),
      }),
    ],
    banner: [
      `runner image: ${config.image}`,
      `docker:       ${existsSync(config.socket) ? config.socket : 'not mounted — listing only'}`,
      `ports:        ${portFrom}-${portTo}`,
    ],
  });
}

main().catch((err) => {
  console.error('[RunnerManager] failed to start:', err);
  process.exit(1);
});
