/**
 * HATS Project Server.
 *
 * Owns project definitions — the objective, the team roster and the shared
 * tools. The Project Designer writes them; the Team Runner reads the active one
 * and writes back what the team changes at runtime.
 */

import { metaRoutes, runnerGate, runnerToken, startService } from '@hats/service-kit/index';
import { initCatalogue } from '@hats/core/mcp/catalogue-store';
import { AgentLibraryClient } from '@hats/clients/agent-library-client';
import { activeFilePath, config } from './config.js';
import { ProjectStore } from './project-store.js';
import { projectRoutes } from './routes/projects.js';
import { eventRoutes } from './routes/events.js';
import { teamRoutes } from './routes/team.js';
import { mcpRoutes } from './routes/mcp.js';
import { visitRoutes } from './routes/visits.js';
import { VisitService } from './visits/visit-service.js';

async function main(): Promise<void> {
  const store = new ProjectStore({
    definitionsDir: config.definitionsDir,
    projectsRoot: config.projectsRoot,
    activeFile: activeFilePath,
  });
  await store.load();
  const visits = new VisitService(store, config.visitsDir);
  await visits.load();

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
      ...eventRoutes(store),
      // Only runners take part in visits: with the installation's runner token.
      ...visitRoutes(visits, runnerGate(runnerToken())),
      ...teamRoutes(store, library),
      ...mcpRoutes(),
    ],
    banner: [
      `definitions:   ${config.definitionsDir} (${store.size} loaded)`,
      `projects root: ${config.projectsRoot}`,
      `Agent Template Library: ${config.agentLibraryUrl}`,
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
