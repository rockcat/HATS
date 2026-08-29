import * as path from 'path';

const REPO_ROOT = path.resolve(process.cwd());

export const config = {
  name: 'AgentLibrary',
  version: '1.0.0',
  port: Number(process.env['AGENT_LIBRARY_PORT'] ?? 3010),
  /** One JSON file per template. */
  templatesDir: path.resolve(
    process.env['AGENT_LIBRARY_DIR'] ?? path.join(REPO_ROOT, 'runtime_data', 'agent-library', 'templates'),
  ),
  /** Legacy flat agents.json imported once on first start. */
  legacyAgentsFile: path.resolve(
    process.env['AGENT_LIBRARY_LEGACY_FILE'] ?? path.join(REPO_ROOT, 'projects', 'agents.json'),
  ),
  avatarsDir: path.resolve(process.env['AVATARS_DIR'] ?? path.join(REPO_ROOT, 'avatars')),
} as const;
