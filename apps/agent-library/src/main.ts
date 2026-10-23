/**
 * HATS Agent Library service.
 *
 * Owns agent templates and nothing else — no projects, no orchestration, no
 * running agents. It depends on no other HATS service: everything it needs is
 * on disk, so it starts and works whether or not a Team Runner exists.
 *
 * Start it with `npm run agent-library`.
 */

import * as path from 'path';
import { fileURLToPath } from 'url';
import { metaRoutes, startService } from '@hats/service-kit/index';
import { uiKitMount } from '../../../packages/ui-kit/index.js';
import { initCatalogue } from '@hats/core/mcp/catalogue-store';
import { config } from './config.js';
import { CredentialStore } from './credential-store.js';
import { TemplateStore } from './template-store.js';
import { templateRoutes } from './routes/templates.js';
import { catalogueRoutes } from './routes/catalogue.js';
import { mcpRoutes } from './routes/mcp.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

async function main(): Promise<void> {
  const store = new TemplateStore(config.templatesDir);
  await store.load();

  // Same catalogue file the runner uses, so both agree on what an MCP server is.
  await initCatalogue(config.catalogueFile);

  const credentials = new CredentialStore(config.credentialsFile);
  await credentials.load();

  const imported = await store.importLegacy(config.legacyAgentsFile);
  if (imported > 0) console.log(`[${config.name}] imported ${imported} agent(s) from the legacy agents.json`);
  for (const bad of store.invalidRecords) {
    console.warn(`[${config.name}] ignoring invalid template ${bad.file}: ${bad.reason}`);
  }

  await startService({
    name: config.name,
    port: config.port,
    publicDir: PUBLIC_DIR,
    mounts: [
      uiKitMount(),
      // The editor previews the GLB/VRM avatar and the background image, so the
      // library serves the same assets the runner does.
      { prefix: '/avatars', dir: config.avatarsDir },
      { prefix: '/backgrounds', dir: config.backgroundsDir },
      { prefix: '/nm', dir: config.nodeModulesDir },
    ],
    routes: [
      ...metaRoutes({
        base: '/api/v1',
        openApi: 'agentLibrary',
        health: () => ({
          service: 'agent-library',
          version: config.version,
          templateCount: store.size,
          invalidRecords: store.invalidRecords.length,
        }),
      }),
      ...templateRoutes(store),
      ...catalogueRoutes(config.avatarsDir, config.backgroundsDir, config.voicesDir, config.speechServiceUrl),
      ...mcpRoutes(store, credentials),
    ],
    banner: [
      `templates:   ${config.templatesDir} (${store.size} loaded)`,
      `credentials: ${config.credentialsFile}`,
      `voices:      ${config.voicesDir}`,
      `speech:      ${config.speechServiceUrl}  (optional — only needed to hear a voice)`,
      `OpenAPI:     http://localhost:${config.port}/api/v1/openapi.yaml`,
    ],
  });
}

main().catch((err) => {
  console.error(`[${config.name}] failed to start:`, err);
  process.exit(1);
});
