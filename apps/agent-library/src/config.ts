import * as path from 'path';
import { runtimeDir } from '../../../server/src/util/runtime-dir.js';

const REPO_ROOT = path.resolve(process.cwd());

/** Where the Team Runner keeps its projects — the legacy agents.json lives here. */
const PROJECTS_ROOT = process.env['PROJECTS_ROOT']
  ? path.resolve(process.env['PROJECTS_ROOT'])
  : runtimeDir('projects');

export const config = {
  name: 'AgentLibrary',
  version: '1.0.0',
  port: Number(process.env['AGENT_LIBRARY_PORT'] ?? 3010),
  /** One JSON file per template. */
  templatesDir: path.resolve(
    process.env['AGENT_LIBRARY_DIR'] ?? runtimeDir('agent-library', 'templates'),
  ),
  /** Legacy flat agents.json imported once on first start. */
  legacyAgentsFile: path.resolve(
    process.env['AGENT_LIBRARY_LEGACY_FILE'] ?? path.join(PROJECTS_ROOT, 'agents.json'),
  ),
  /** Avatars and backgrounds live under runtime_data, same as the runner uses. */
  avatarsDir: path.resolve(process.env['AVATARS_DIR'] ?? runtimeDir('avatars')),
  get backgroundsDir(): string { return path.join(this.avatarsDir, 'backgrounds'); },
  /** three.js and @pixiv/three-vrm are served from here for the avatar preview. */
  nodeModulesDir: path.join(REPO_ROOT, 'node_modules'),
  /** Shared with the Team Runner so both see the same MCP definitions. */
  catalogueFile: runtimeDir('config', 'mcp-catalogue.json'),
  /** Piper voice models, read for the editor's voice and speaker dropdowns. */
  voicesDir: path.resolve(process.env['PIPER_VOICES_DIR'] ?? runtimeDir('piper_voices')),
  /**
   * Per-agent MCP credentials. Deliberately the same file the runner reads —
   * a secret belongs to the machine, not to the shared template document.
   */
  credentialsFile: path.join(PROJECTS_ROOT, 'agent-credentials.json'),
  /** Used by the editor's chat panel to reach a deployed agent. */
  teamRunnerUrl: process.env['TEAM_RUNNER_URL'] ?? 'http://localhost:3001',
  /** Credential the chat proxy presents to the runner, which authenticates /api/*. */
  runnerApiKey: process.env['HATS_API_KEY'] ?? '',
} as const;
