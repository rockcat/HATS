import * as path from 'path';
import { runtimeDir } from '@hats/core/runtime-dir';

export const config = {
  name: 'ProjectServer',
  version: '1.0.0',
  port: Number(process.env['PROJECT_SERVER_PORT'] ?? 3020),
  /** One JSON file per project definition. */
  definitionsDir: path.resolve(
    process.env['PROJECT_DEFINITIONS_DIR'] ?? runtimeDir('project-server', 'definitions'),
  ),
  /** One JSON file per visit, with its travel packs beside them in packs/. */
  visitsDir: path.resolve(process.env['PROJECT_VISITS_DIR'] ?? runtimeDir('project-server', 'visits')),
  /** One JSON file per permanent move, with its pack beside it in packs/. */
  movesDir: path.resolve(process.env['PROJECT_MOVES_DIR'] ?? runtimeDir('project-server', 'moves')),
  /** Where the Team Runner keeps each project's working files — must match the runner. */
  projectsRoot: process.env['PROJECTS_ROOT']
    ? path.resolve(process.env['PROJECTS_ROOT'])
    : runtimeDir('projects'),
  /** Shared with the Team Runner and Agent Template Library so all three agree on MCP servers. */
  catalogueFile: runtimeDir('config', 'mcp-catalogue.json'),
  /** Used to resolve templateId when deploying an agent into a project. */
  agentLibraryUrl: process.env['AGENT_LIBRARY_URL'] ?? 'http://localhost:3010',
} as const;

export const activeFilePath = path.join(config.definitionsDir, '..', 'active-project.json');
