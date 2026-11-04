/**
 * Team runner — embodies a project's team and serves the Embodiment API.
 *
 * Usage:
 *   node --env-file=.env --import tsx/esm server/src/team-runner.ts [project-id]
 *
 * The runner no longer owns agent definitions or project definitions. It reads
 * them from two services and writes runtime changes back:
 *
 *   Agent Library  (AGENT_LIBRARY_URL,  default http://localhost:3010)
 *   Project Server (PROJECT_SERVER_URL, default http://localhost:3020)
 *
 * Either can be absent. With `--standalone` — or when a service is simply not
 * running — the runner falls back to the local project folder and a local
 * agents.json exactly as it behaved before the services were split out.
 *
 * Project layout:
 *   <PROJECTS_ROOT>/<project-id>/
 *     team-state.json    — conversation histories and runtime state
 *     team-events.jsonl  — append-only event log
 *     kanban-board.json  — ticket board
 *     mcp-enabled.json   — persisted MCP server toggles
 *     <ticket-id>/       — agent outputs per ticket (e.g. TKT-001/)
 */

// First: saved settings must be in the environment before anything reads it.
import './load-settings.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { settingsFile } from './settings-file.js';
import { mkdir } from 'fs/promises';
import * as path from 'path';
import { CLIInterface } from './human/cli-interface.js';
import { APIServer } from './api/api-server.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { OpenAIProvider, OllamaProvider, LMStudioProvider } from './providers/openai.js';
import { GeminiProvider } from './providers/gemini.js';
import { HatType } from '../../packages/core/src/hats/types.js';
import { initCatalogue } from '../../packages/core/src/mcp/catalogue-store.js';
import { AgentStore, type AgentDefinitionStore } from './api/agent-store.js';
import { LibraryAgentStore } from './api/library-agent-store.js';
import { ScheduledActionStore } from './api/scheduled-action-store.js';
import { seedBuiltIns } from './store/built-in-agents.js';
import { runtimeDir } from '../../packages/core/src/runtime-dir.js';
import { seedMissing } from './util/seed-data.js';
import { UserStore } from './api/user-store.js';
import { loadSessions } from './api/auth-middleware.js';
import { AgentLibraryClient } from '../../packages/clients/src/agent-library-client.js';
import { resolveProjectSource } from './project/project-source.js';
import { ProjectSync } from './project/project-sync.js';
import { makeProjectLoader, type LoadedProject } from './project/project-loader.js';

// ── Project layout ────────────────────────────────────────────────────────────

const CATALOGUE_FILE = runtimeDir('config', 'mcp-catalogue.json');

// ── CLI flags ─────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const NO_EMAIL   = argv.includes('--no-email');
const STANDALONE = argv.includes('--standalone') || process.env['HATS_STANDALONE'] === '1';
if (NO_EMAIL) process.env['HATS_NO_EMAIL'] = '1';

/**
 * Run without the chat CLI, as a service does.
 *
 * The CLI closes the process when its input ends. That is right at a
 * terminal, where the input ending means the person has gone, and wrong
 * everywhere else: in a container there is no stdin at all, so the runner
 * used to start, restore its state, and exit within a second of being
 * launched — looking for all the world like a crash.
 *
 * Detected rather than only declared, because the common cases are not ones
 * anybody remembers to pass a flag for: `docker run` without -i, a systemd
 * unit, a CI job. Pass --headless to be explicit, or HATS_FORCE_CLI=1 to
 * insist on the CLI when piping commands into it on purpose.
 */
const HEADLESS = argv.includes('--headless')
  || process.env['HATS_HEADLESS'] === '1'
  || (!process.stdin.isTTY && process.env['HATS_FORCE_CLI'] !== '1');
const positionalArgs = argv.filter(a => !a.startsWith('--'));

const PROJECTS_ROOT = process.env['PROJECTS_ROOT']
  ? path.resolve(process.env['PROJECTS_ROOT'])
  : runtimeDir('projects');

/** An explicitly requested project id, or undefined to take the server's active one. */
const REQUESTED_PROJECT = (() => {
  if (positionalArgs[0]) return positionalArgs[0];
  if (process.env['npm_config_project']) return process.env['npm_config_project'];
  const envProject = process.env['TEAM_PROJECT'];
  if (envProject && envProject !== 'default') return envProject;
  return undefined;
})();

/** Only consulted when no project server is available. */
const LOCAL_FALLBACK_PROJECT = (() => {
  const lastFile = path.join(PROJECTS_ROOT, 'last-project.json');
  if (existsSync(lastFile)) {
    try { const { id } = JSON.parse(readFileSync(lastFile, 'utf8')); if (id) return id as string; } catch { /* ignore */ }
  }
  return process.env['TEAM_PROJECT'] ?? 'default';
})();

const AGENT_LIBRARY_URL  = STANDALONE ? null : (process.env['AGENT_LIBRARY_URL']  ?? 'http://localhost:3010');
const PROJECT_SERVER_URL = STANDALONE ? null : (process.env['PROJECT_SERVER_URL'] ?? 'http://localhost:3020');

// ── Provider factory ──────────────────────────────────────────────────────────

const claude = new AnthropicProvider();
const DEFAULT_MODEL = process.env['ANTHROPIC_MODEL'] ?? 'claude-haiku-4-5-20251001';

function providerFactory(name: string) {
  if (name === 'anthropic') return claude;
  if (name === 'openai')    return new OpenAIProvider();
  if (name === 'gemini')    return new GeminiProvider();
  if (name === 'ollama')    return new OllamaProvider();
  if (name === 'lmstudio')  return new LMStudioProvider();
  throw new Error(`Unknown provider: "${name}"`);
}

// ── Agent library ─────────────────────────────────────────────────────────────

/** Prefer the Agent Library service; fall back to the local agents.json. */
async function makeAgentStore(): Promise<AgentDefinitionStore> {
  if (AGENT_LIBRARY_URL) {
    const client = new AgentLibraryClient(AGENT_LIBRARY_URL);
    if (await client.isHealthy()) {
      const store = new LibraryAgentStore(
        client,
        path.join(PROJECTS_ROOT, 'agent-credentials.json'),
      );
      await store.load();
      return store;
    }
    console.log(`[Team] Agent Library at ${AGENT_LIBRARY_URL} is not answering — using the local agents.json`);
  }
  const store = new AgentStore(path.join(PROJECTS_ROOT, 'agents.json'));
  await store.load();
  return store;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // The image sets this; a source checkout already has its defaults in place.
  const defaults = process.env['HATS_DEFAULTS_DIR'];
  if (defaults) {
    const seeded = await seedMissing(defaults, runtimeDir());
    if (seeded.length > 0) console.log(`[Team] First run: copied ${seeded.length} default file(s) into the data directory`);
  }

  await mkdir(PROJECTS_ROOT, { recursive: true });
  await initCatalogue(CATALOGUE_FILE);

  const project = await resolveProjectSource({
    projectServerUrl:   PROJECT_SERVER_URL,
    requestedProjectId: REQUESTED_PROJECT,
    projectsRoot:       PROJECTS_ROOT,
    fallbackProjectId:  LOCAL_FALLBACK_PROJECT,
  });

  const PROJECT_DIR = project.projectDir;
  await mkdir(PROJECT_DIR, { recursive: true });

  const STATE_FILE     = path.join(PROJECT_DIR, 'team-state.json');
  const EVENTS_FILE    = path.join(PROJECT_DIR, 'team-events.jsonl');
  const KANBAN_FILE    = path.join(PROJECT_DIR, 'kanban-board.json');
  const REQUESTS_FILE  = path.join(PROJECT_DIR, 'human-requests.json');
  const ALLOWLIST_FILE = path.join(PROJECT_DIR, 'email-allowlist.json');
  const MCP_FILE       = path.join(PROJECT_DIR, 'mcp-enabled.json');
  const MEETINGS_FILE  = path.join(PROJECT_DIR, 'meetings.json');

  console.log(`[Team] Project : ${project.projectName} (${project.projectId}) via ${project.source}`);
  console.log(`[Team] Folder  : ${PROJECT_DIR}`);
  writeFileSync(path.join(PROJECTS_ROOT, 'last-project.json'), JSON.stringify({ id: project.projectId }));

  const agentStore  = await makeAgentStore();
  const actionStore = new ScheduledActionStore(path.join(PROJECTS_ROOT, 'scheduled-actions.json'));
  await actionStore.load();
  // makeAgentStore() has already loaded the store; seeding adds the built-in
  // agents (Claude Code) when they are not present yet.
  await seedBuiltIns(agentStore);

  const userStore = new UserStore(runtimeDir('data', 'users.json'));
  await userStore.load();
  await loadSessions(runtimeDir('data', 'sessions.json'));
  if (userStore.isEmpty()) {
    const username = process.env['HATS_ADMIN_USERNAME'] ?? 'admin';
    const password = process.env['HATS_ADMIN_PASSWORD'] ?? 'changeme';
    await userStore.createUser(username, password, 'admin');
    console.log(`[Auth] Created initial admin user: ${username}`);
    if (!process.env['HATS_ADMIN_PASSWORD']) {
      console.warn('[Auth] WARNING: Using default password "changeme" — set HATS_ADMIN_PASSWORD in .env');
    }
  }

  // Mirror runtime team changes back into the open project's definition. One
  // sync per open project: it used to stay bound to the startup project and
  // its orchestrator, and after a switch went on writing teams into the
  // wrong definition.
  let sync: ProjectSync | null = null;
  const bindSync = async ({ orchestrator: orch, definition, client }: LoadedProject): Promise<void> => {
    const previous = sync;
    sync = null;
    if (previous) { previous.stop(); await previous.flush().catch(() => {}); }
    if (!client || !definition) return;
    const next = new ProjectSync(client, definition, () => orch);
    sync = next;
    await next.flush();
    orch.onEvent((ev) => {
      if (['task_complete', 'state_saved', 'agent_disengaged'].includes(ev.type) && sync === next) next.schedule();
    });
  };

  // The startup project was read a moment ago; every later visit reads afresh.
  let startupSource: { id: string; definition: typeof project.definition; client: typeof project.client } | null =
    { id: project.projectId, definition: project.definition, client: project.client };
  const loader = makeProjectLoader({
    agentStore,
    providerFactory,
    defaultModel: DEFAULT_MODEL,
    // Read for each project as it is opened — never the startup project's.
    sourceFor: async (projectId) => {
      if (startupSource && startupSource.id === projectId) {
        const { definition, client } = startupSource;
        startupSource = null;
        return { definition, client };
      }
      const resolved = await resolveProjectSource({
        projectServerUrl:   PROJECT_SERVER_URL,
        requestedProjectId: projectId,
        projectsRoot:       PROJECTS_ROOT,
        fallbackProjectId:  projectId,
      });
      return { definition: resolved.definition, client: resolved.client };
    },
    onLoaded: bindSync,
  });
  const orchestrator = await loader(PROJECT_DIR, KANBAN_FILE, STATE_FILE);

  console.log(`[Team] Events → ${EVENTS_FILE}`);
  console.log(`[Team] State  → ${STATE_FILE}  (saved on Ctrl+C)\n`);

  const api = new APIServer(orchestrator, {
    port:           Number(process.env['TEAM_RUNNER_PORT'] ?? 3001),
    kanbanPath:     KANBAN_FILE,
    requestsPath:   REQUESTS_FILE,
    allowlistPath:  ALLOWLIST_FILE,
    mcpEnabledPath: MCP_FILE,
    meetingsPath:   MEETINGS_FILE,
    envPath:        settingsFile(),
    projectId:      project.projectId,
    projectName:    project.projectName,
    projectSource:  project.source,
    projectDir:     PROJECT_DIR,
    projectsRoot:   PROJECTS_ROOT,
    projectLoader:  loader,
    agentLibraryUrl:  AGENT_LIBRARY_URL,
    projectServerUrl: PROJECT_SERVER_URL,
    agentStore,
    actionStore,
    userStore,
  });
  api.start();


  // SIGTERM as well as SIGINT. Ctrl+C sends SIGINT, but `docker stop` — and
  // so every compose restart and recreate — sends SIGTERM, which nothing
  // handled. In a container the final save never ran: whatever had changed
  // since the last turn was simply lost on every stop.
  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;            // a second signal must not race the first save
    stopping = true;
    console.log(`[Team] ${signal} — saving state and stopping`);
    sync?.stop();
    await sync?.flush().catch(() => {});
    await api.shutdown();
    process.exit(0);
  };
  process.on('SIGINT', () => { void shutdown('SIGINT'); });
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });

  if (HEADLESS) {
    // The API server's listening socket is what keeps the process alive, so
    // there is nothing to start here — only to say so, because a runner that
    // prints nothing after this point looks hung rather than ready.
    console.log('[Team] Headless — no chat CLI. Talk to it through the web UI or the API.');
    return;
  }

  const blueHat = orchestrator.listAgents().find(a => a.hatType.includes(HatType.Blue));
  const cli = new CLIInterface(orchestrator, blueHat?.name ?? orchestrator.listAgents()[0]?.name ?? 'Amara', STATE_FILE, providerFactory);

  api.onProjectSwitch((newOrchestrator) => { cli.setOrchestrator(newOrchestrator); });

  cli.start();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
