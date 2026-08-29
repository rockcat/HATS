/**
 * HATS Agent Library service.
 *
 * Owns agent templates and nothing else — no projects, no orchestration, no
 * running agents. Start it with `npm run agent-library`.
 */

import * as path from 'path';
import { fileURLToPath } from 'url';
import { metaRoutes, startService } from '../../../packages/service-kit/src/index.js';
import { uiKitMount } from '../../../packages/ui-kit/index.js';
import { config } from './config.js';
import { TemplateStore } from './template-store.js';
import { templateRoutes } from './routes/templates.js';
import { catalogueRoutes } from './routes/catalogue.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

async function main(): Promise<void> {
  const store = new TemplateStore(config.templatesDir);
  await store.load();

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
      // The editor previews the GLB avatar and the background image, so the
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
      ...catalogueRoutes(config.avatarsDir, config.backgroundsDir),
    ],
    banner: [
      `templates: ${config.templatesDir} (${store.size} loaded)`,
      `OpenAPI:   http://localhost:${config.port}/api/v1/openapi.yaml`,
    ],
  });
}

main().catch((err) => {
  console.error(`[${config.name}] failed to start:`, err);
  process.exit(1);
});
