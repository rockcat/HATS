import * as path from 'path';

const REPO_ROOT = path.resolve(process.cwd());

export const config = {
  name: 'ProjectServer',
  version: '1.0.0',
  port: Number(process.env['PROJECT_SERVER_PORT'] ?? 3020),
  /** One JSON file per project definition. */
  definitionsDir: path.resolve(
    process.env['PROJECT_DEFINITIONS_DIR'] ?? path.join(REPO_ROOT, 'runtime_data', 'project-server', 'definitions'),
  ),
  /** Where the Team Runner keeps each project's working files. */
  projectsRoot: path.resolve(process.env['PROJECTS_ROOT'] ?? path.join(REPO_ROOT, 'projects')),
  /** Used to resolve templateId when deploying an agent into a project. */
  agentLibraryUrl: process.env['AGENT_LIBRARY_URL'] ?? 'http://localhost:3010',
} as const;

export const activeFilePath = path.join(config.definitionsDir, '..', 'active-project.json');
