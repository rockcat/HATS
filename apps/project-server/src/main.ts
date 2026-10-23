/**
 * HATS Project Server.
 *
 * Owns project definitions — the objective, the team roster and the shared
 * tools. The Project Designer writes them; the Team Runner reads the active one
 * and writes back what the team changes at runtime.
 */

import { metaRoutes, startService } from '../../../packages/service-kit/src/index.js';
import { initCatalogue } from '../../../packages/core/src/mcp/catalogue-store.js';
import { AgentLibraryClient } from '../../../packages/clients/src/agent-library-client.js';
import { activeFilePath, config } from './config.js';
import { ProjectStore } from './project-store.js';
import { projectRoutes } from './routes/projects.js';
import { teamRoutes } from './routes/team.js';
import { mcpRoutes } from './routes/mcp.js';

async function main(): Promise<void> {
  const store = new ProjectStore({
    definitionsDir: config.definitionsDir,
    projectsRoot: config.projectsRoot,
    activeFile: activeFilePath,
  });
  await store.load();

  for (const bad of store.invalidRecords) {
    console.warn(`[${config.name}] ignoring invalid project ${bad.file}: ${bad.reason}`);
  }

  // The same catalogue file the runner and the library read, so all three
  // agree on what an MCP server is.
  await initCatalogue(config.catalogueFile);

  const library = new AgentLibraryClient(config.agentLibraryUrl);

  await startService({
    name: config.name,
    port: config.port,
    routes: [
      ...metaRoutes({
        base: '/api/v1',
        openApi: 'projectServer',
        health: () => ({
          service: 'project-server',
          version: config.version,
          projectCount: store.size,
          activeProjectId: store.activeProjectId,
        }),
      }),
      ...projectRoutes(store),
      ...teamRoutes(store, library),
      ...mcpRoutes(),
    ],
    banner: [
      `definitions:   ${config.definitionsDir} (${store.size} loaded)`,
      `projects root: ${config.projectsRoot}`,
      `agent library: ${config.agentLibraryUrl}`,
      `mcp catalogue: ${config.catalogueFile}`,
      `active:        ${store.activeProjectId ?? '(none)'}`,
      `OpenAPI:       http://localhost:${config.port}/api/v1/openapi.yaml`,
    ],
  });
}

main().catch((err) => {
  console.error(`[${config.name}] failed to start:`, err);
  process.exit(1);
});
