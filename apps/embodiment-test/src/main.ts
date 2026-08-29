/**
 * Embodiment API test harness.
 *
 * A deliberately minimal client whose only job is to prove the Embodiment API:
 * roster, live state, conversation, and voice — nothing borrowed from the
 * runner's own dashboard. If this app can drive a team, so can any third party.
 */

import * as path from 'path';
import { fileURLToPath } from 'url';
import { get, json, proxyRoutes, startService } from '../../../packages/service-kit/src/index.js';
import { uiKitMount } from '../../../packages/ui-kit/index.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const config = {
  name: 'EmbodimentTest',
  version: '1.0.0',
  port: Number(process.env['EMBODIMENT_TEST_PORT'] ?? 3040),
  teamRunnerUrl: process.env['TEAM_RUNNER_URL'] ?? 'http://localhost:3001',
};

await startService({
  name: config.name,
  port: config.port,
  publicDir: PUBLIC_DIR,
  mounts: [uiKitMount()],
  routes: [
    get('/api/v1/health', ({ res }) => json(res, 200, {
      ok: true, service: 'embodiment-test', version: config.version,
    })),
    get('/api/v1/config', ({ res }) => json(res, 200, { teamRunnerUrl: config.teamRunnerUrl })),
    // Everything under /runner is the Team Runner's Embodiment API verbatim,
    // so the browser sees exactly the paths in the OpenAPI document.
    ...proxyRoutes({
      prefix: '/runner',
      target: config.teamRunnerUrl,
      label: 'Team Runner',
      timeoutMs: 120_000,
    }),
  ],
  banner: [
    `team runner: ${config.teamRunnerUrl}`,
    `proxying:    /runner/api/embodiment/v1/*`,
  ],
});
