/**
 * Looking at the work, rather than managing the runner.
 *
 * The first cut of the split described in docs/architecture-split.md. The
 * dashboard grew to cover two jobs — managing the runner, and seeing what the
 * team is doing — and they want different things: one is for whoever is
 * operating the system, the other for whoever cares about the project.
 *
 * This is deliberately a separate app rather than a tab filter, because the
 * point is to find out what the project side actually needs. Whatever this
 * app calls is the surface a Workspace service would have to provide; the
 * list is measured here rather than argued about.
 *
 * It proxies the runner for now. The next step is that it stops needing to.
 */

import * as path from 'path';
import { fileURLToPath } from 'url';
import { get, json, proxyRoutes, startService } from '../../../packages/service-kit/src/index.js';
import { uiKitMount } from '../../../packages/ui-kit/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, '..', 'public');

const config = {
  name: 'ProjectView',
  version: '1.0.0',
  port: Number(process.env['PROJECT_VIEW_PORT'] ?? 3070),
  teamRunnerUrl: process.env['TEAM_RUNNER_URL'] ?? 'http://localhost:3001',
  /** The runner authenticates /api/*. Attached by the proxy, never sent to the page. */
  apiKey: process.env['HATS_API_KEY'] ?? '',
};

/**
 * Everything this app is allowed to reach on the runner.
 *
 * An allow-list rather than a blanket proxy, and not a security measure — the
 * runner is behind the same key either way. It is a record. The moment a panel
 * needs something not on this list, that is a decision about what belongs in a
 * Workspace, and it should be a visible one rather than a line quietly added
 * to a fetch call.
 */
const WORKSPACE_SURFACE = [
  '/api/kanban',            // the board
  '/api/scheduled-meetings', // the calendar
  '/api/meetings',          // minutes of past meetings
  '/api/human-requests',    // things waiting on a person
  '/api/project',           // goal, files, outputs
  '/api/telemetry',         // what it has cost
  '/api/email-allowlist',   // who agents may write to
  '/api/agents',            // read-only: who is on the team
  '/api/events',            // the live stream
];

await startService({
  name: config.name,
  port: config.port,
  publicDir: PUBLIC_DIR,
  mounts: [uiKitMount()],
  routes: [
    get('/api/v1/health', ({ res }) => json(res, 200, {
      ok: true, service: 'project-view', version: config.version,
    })),
    /** The measured surface, served so it can be read rather than inferred. */
    get('/api/v1/surface', ({ res }) => json(res, 200, { surface: WORKSPACE_SURFACE })),
    ...proxyRoutes({
      prefix: '/runner',
      target: config.teamRunnerUrl,
      label: 'Team Runner',
      timeoutMs: 60_000,
      ...(config.apiKey && { headers: { 'X-API-Key': config.apiKey } }),
    }),
  ],
  banner: [
    `team runner:   ${config.teamRunnerUrl}  →  /runner/api/*`,
    `surface:       ${WORKSPACE_SURFACE.length} paths — see /api/v1/surface`,
    config.apiKey
      ? 'auth:          X-API-Key from HATS_API_KEY'
      : 'auth:          HATS_API_KEY not set — the runner will answer 401.'
        + ' Mint one with: node --env-file=.env scripts/issue-api-key.mjs',
  ],
});
