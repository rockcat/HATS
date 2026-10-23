/**
 * HATS Project Designer.
 *
 * A UI-only application: it holds no state of its own. Agent templates come
 * from the Agent Library, project definitions go to the Project Server, and
 * both are reached through this server's proxy so the browser only ever talks
 * to one origin.
 */

import * as path from 'path';
import { fileURLToPath } from 'url';
import { get, json, proxyRoutes, startService } from '@hats/service-kit/index';
import { uiKitMount } from '../../../packages/ui-kit/index.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const config = {
  name: 'ProjectDesigner',
  version: '1.0.0',
  port: Number(process.env['PROJECT_DESIGNER_PORT'] ?? 3030),
  agentLibraryUrl: process.env['AGENT_LIBRARY_URL'] ?? 'http://localhost:3010',
  projectServerUrl: process.env['PROJECT_SERVER_URL'] ?? 'http://localhost:3020',
};

await startService({
  name: config.name,
  port: config.port,
  publicDir: PUBLIC_DIR,
  mounts: [uiKitMount()],
  routes: [
    get('/api/v1/health', ({ res }) => json(res, 200, {
      ok: true,
      service: 'project-designer',
      version: config.version,
    })),
    // The browser reads this to know where the upstreams live, for deep links.
    get('/api/v1/config', ({ res }) => json(res, 200, {
      agentLibraryUrl: config.agentLibraryUrl,
      projectServerUrl: config.projectServerUrl,
    })),
    ...proxyRoutes({ prefix: '/proxy/library', target: config.agentLibraryUrl, label: 'Agent Library' }),
    ...proxyRoutes({ prefix: '/proxy/projects', target: config.projectServerUrl, label: 'Project Server' }),
  ],
  banner: [
    `agent library:  ${config.agentLibraryUrl}`,
    `project server: ${config.projectServerUrl}`,
  ],
});
