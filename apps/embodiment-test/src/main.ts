/**
 * Embodiment API test harness.
 *
 * A deliberately minimal client whose only job is to prove the Embodiment API:
 * roster, live state, conversation, voice and face — nothing borrowed from the
 * runner's own dashboard. If this app can drive a team, so can any third party.
 *
 * It reads the Agent Library too, so the roster shows every agent that exists
 * and not only the handful the current project happens to be running. That is a
 * property of this harness, not of the Embodiment API: the runner still knows
 * nothing about the library, and the library still knows nothing about the
 * runner. Either upstream can be absent and the other half still works.
 */

import * as path from 'path';
import { fileURLToPath } from 'url';
import { get, json, proxyRoutes, startService } from '@hats/service-kit/index';
import { uiKitMount } from '../../../packages/ui-kit/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, '..', 'public');
/** three.js and @pixiv/three-vrm, served for the avatar stage. */
const NODE_MODULES_DIR = path.resolve(process.cwd(), 'node_modules');

const config = {
  name: 'EmbodimentTest',
  version: '1.0.0',
  port: Number(process.env['EMBODIMENT_TEST_PORT'] ?? 3040),
  teamRunnerUrl: process.env['TEAM_RUNNER_URL'] ?? 'http://localhost:3001',
  agentLibraryUrl: process.env['AGENT_LIBRARY_URL'] ?? 'http://localhost:3010',
  /**
   * The Team Runner authenticates /api/*, so the harness needs a credential.
   * Create an API key in the dashboard's Users tab and set HATS_API_KEY. It is
   * attached by the proxy server-side and never reaches the browser.
   */
  apiKey: process.env['HATS_API_KEY'] ?? '',
};

await startService({
  name: config.name,
  port: config.port,
  publicDir: PUBLIC_DIR,
  mounts: [uiKitMount(), { prefix: '/nm', dir: NODE_MODULES_DIR }],
  routes: [
    get('/api/v1/health', ({ res }) => json(res, 200, {
      ok: true, service: 'embodiment-test', version: config.version,
    })),
    get('/api/v1/config', ({ res }) => json(res, 200, {
      teamRunnerUrl: config.teamRunnerUrl,
      agentLibraryUrl: config.agentLibraryUrl,
    })),
    // Everything under /runner is the Team Runner's Embodiment API verbatim,
    // so the browser sees exactly the paths in the OpenAPI document.
    ...proxyRoutes({
      prefix: '/runner',
      target: config.teamRunnerUrl,
      label: 'Team Runner',
      timeoutMs: 120_000,
      ...(config.apiKey && { headers: { 'X-API-Key': config.apiKey } }),
    }),
    // The Agent Library, for the agents that exist but are not deployed. It
    // needs no credential, and its static /avatars and /backgrounds mounts come
    // through here too so a library-only agent still has a face.
    ...proxyRoutes({
      prefix: '/library',
      target: config.agentLibraryUrl,
      label: 'Agent Library',
      timeoutMs: 30_000,
    }),
  ],
  banner: [
    `team runner:   ${config.teamRunnerUrl}  →  /runner/api/embodiment/v1/*`,
    `agent library: ${config.agentLibraryUrl}  →  /library/api/v1/*  (optional)`,
    config.apiKey
      ? 'auth:          X-API-Key from HATS_API_KEY'
      : 'auth:          HATS_API_KEY not set — the runner will answer 401.'
        + ' Mint one with: node --env-file=.env scripts/issue-api-key.mjs',
  ],
});
