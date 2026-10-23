import * as path from 'path';
import { runtimeDir } from '../../../packages/core/src/runtime-dir.js';

export const config = {
  name: 'ProjectServer',
  version: '1.0.0',
  port: Number(process.env['PROJECT_SERVER_PORT'] ?? 3020),
  /** One JSON file per project definition. */
  definitionsDir: path.resolve(
    process.env['PROJECT_DEFINITIONS_DIR'] ?? runtimeDir('project-server', 'definitions'),
  ),
  /** Where the Team Runner keeps each project's working files — must match the runner. */
  projectsRoot: process.env['PROJECTS_ROOT']
    ? path.resolve(process.env['PROJECTS_ROOT'])
    : runtimeDir('projects'),
  /** Shared with the Team Runner and Agent Library so all three agree on MCP servers. */
  catalogueFile: runtimeDir('config', 'mcp-catalogue.json'),
  /** Used to resolve templateId when deploying an agent into a project. */
  agentLibraryUrl: process.env['AGENT_LIBRARY_URL'] ?? 'http://localhost:3010',
} as const;

export const activeFilePath = path.join(config.definitionsDir, '..', 'active-project.json');
