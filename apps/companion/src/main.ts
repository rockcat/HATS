/**
 * One agent, a face, a voice — in a browser.
 *
 * The same conversation as the phone client, without the phone. Where the
 * Embodiment Test harness is a roster you can poke at every agent from, this
 * is the other shape: you pick one agent and then it is just that agent, with
 * its face, its voice, and this tab as a device it can take photographs with.
 *
 * It is the browser's job because the browser is already good at it. A Flutter
 * web build would nest a WebView inside a browser to render the avatar, which
 * `webview_flutter` does not implement, to reach APIs — getUserMedia, Web
 * Speech, SpeechSynthesis — that the page has natively.
 *
 * The runner's credential stays here, server-side, and the page talks to one
 * origin. That is the same posture as the test harness: anybody who can reach
 * this service can talk to the agent, so put it somewhere you are happy with.
 */

import * as path from 'path';
import { fileURLToPath } from 'url';
import { get, json, proxyRoutes, startService } from '@hats/service-kit/index';
import { uiKitMount } from '../../../packages/ui-kit/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, '..', 'public');
/** three.js and @pixiv/three-vrm, for the avatar. */
const NODE_MODULES_DIR = path.resolve(process.cwd(), 'node_modules');

const config = {
  name: 'Companion',
  version: '1.0.0',
  port: Number(process.env['COMPANION_PORT'] ?? 3060),
  teamRunnerUrl: process.env['TEAM_RUNNER_URL'] ?? 'http://localhost:3001',
  /**
   * Which agent this is. Leave it unset and the page asks once, then
   * remembers — the point of the app is that it is one agent, not a roster.
   */
  agentName: process.env['COMPANION_AGENT'] ?? '',
  /** The runner authenticates /api/*. Attached by the proxy, never sent to the page. */
  apiKey: process.env['HATS_API_KEY'] ?? '',
};

await startService({
  name: config.name,
  port: config.port,
  publicDir: PUBLIC_DIR,
  mounts: [uiKitMount(), { prefix: '/nm', dir: NODE_MODULES_DIR }],
  routes: [
    get('/api/v1/health', ({ res }) => json(res, 200, {
      ok: true, service: 'companion', version: config.version,
    })),
    get('/api/v1/config', ({ res }) => json(res, 200, {
      agentName: config.agentName,
      teamRunnerUrl: config.teamRunnerUrl,
    })),
    // The Embodiment API verbatim, so the page sees exactly the paths in the
    // OpenAPI document and nothing here has to be kept in step with it.
    ...proxyRoutes({
      prefix: '/runner',
      target: config.teamRunnerUrl,
      label: 'Team Runner',
      timeoutMs: 120_000,
      ...(config.apiKey && { headers: { 'X-API-Key': config.apiKey } }),
    }),
  ],
  banner: [
    `team runner:   ${config.teamRunnerUrl}  →  /runner/api/embodiment/v1/*`,
    config.agentName
      ? `agent:         ${config.agentName}`
      : 'agent:         not set — the page will ask. Set COMPANION_AGENT to fix one.',
    config.apiKey
      ? 'auth:          X-API-Key from HATS_API_KEY'
      : 'auth:          HATS_API_KEY not set — the runner will answer 401.'
        + ' Mint one with: node --env-file=.env scripts/issue-api-key.mjs',
    'note:          the camera and microphone need a secure context —'
      + ' localhost counts, a bare LAN IP does not.',
  ],
});
