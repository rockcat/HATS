/**
 * Team runner — 6 hat agents with real names + human CLI
 *
 * Usage:
 *   node --env-file=.env --import tsx/esm team-runner.ts [project-id]
 *
 * Project layout:
 *   <PROJECTS_ROOT>/
 *     <project-id>/
 *       team-state.json    — agent snapshots (restored on restart)
 *       team-events.jsonl  — append-only event log
 *       kanban-board.json  — ticket board
 *       mcp-enabled.json   — persisted MCP server toggles
 *       <ticket-id>/       — agent outputs per ticket (e.g. TKT-001/)
 *
 * Set PROJECTS_ROOT env var to change the root (default: ./projects).
 * Set TEAM_PROJECT env var or pass as first CLI arg to select a project (default: default).
 */

import { existsSync } from 'fs';
import { mkdir } from 'fs/promises';
import * as path from 'path';
import { TeamOrchestrator } from './src/orchestrator/orchestrator.js';
import { CLIInterface } from './src/human/cli-interface.js';
import { APIServer, ProjectLoader } from './src/api/api-server.js';
import { AnthropicProvider } from './src/providers/anthropic.js';
import { OpenAIProvider, OllamaProvider, LMStudioProvider } from './src/providers/openai.js';
import { GeminiProvider } from './src/providers/gemini.js';
import { HatType } from './src/hats/types.js';
import { getRandomPersona } from './src/hats/personas.js';
import { initCatalogue } from './src/mcp/catalogue-store.js';

// ── Project layout ────────────────────────────────────────────────────────────

const CATALOGUE_FILE = path.join(process.cwd(), 'config', 'mcp-catalogue.json');
const PROJECTS_ROOT = path.resolve(process.env['PROJECTS_ROOT'] ?? './projects');
const PROJECT_ID    = process.argv[2] ?? process.env['TEAM_PROJECT'] ?? 'default';
const PROJECT_DIR   = path.join(PROJECTS_ROOT, PROJECT_ID);

const STATE_FILE     = path.join(PROJECT_DIR, 'team-state.json');
const EVENTS_FILE    = path.join(PROJECT_DIR, 'team-events.jsonl');
const KANBAN_FILE    = path.join(PROJECT_DIR, 'kanban-board.json');
const REQUESTS_FILE  = path.join(PROJECT_DIR, 'human-requests.json');
const ALLOWLIST_FILE = path.join(PROJECT_DIR, 'email-allowlist.json');
const MCP_FILE       = path.join(PROJECT_DIR, 'mcp-enabled.json');
const MEETINGS_FILE  = path.join(PROJECT_DIR, 'meetings.json');
const AGENDA_FILE    = path.join(PROJECT_DIR, 'agent-agenda.json');

// ── Provider factory ──────────────────────────────────────────────────────────

const claude = new AnthropicProvider();
const model  = process.env['ANTHROPIC_MODEL'] ?? 'claude-haiku-4-5-20251001';

function providerFactory(name: string) {
  if (name === 'anthropic') return claude;
  if (name === 'openai')    return new OpenAIProvider();
  if (name === 'gemini')    return new GeminiProvider();
  if (name === 'ollama')    return new OllamaProvider();
  if (name === 'lmstudio')  return new LMStudioProvider();
  throw new Error(`Unknown provider in snapshot: "${name}"`);
}

// ── Project loader factory ────────────────────────────────────────────────────
// This is passed to APIServer so it can hot-switch projects without restarting.

function makeProjectLoader(): ProjectLoader {
  return async (projectDir: string, kanbanFile: string, stateFile: string) => {
    const eventsFile   = path.join(projectDir, 'team-events.jsonl');
    const meetingsFile = path.join(projectDir, 'meetings.json');

    const orchestrator = new TeamOrchestrator({
      storePath:    eventsFile,
      projectsRoot: projectDir,
      humanName:    'Boss',
    });
    const agendaFile = path.join(projectDir, 'agent-agenda.json');
    await orchestrator.init();
    await orchestrator.initMeetingStore(meetingsFile);
    await orchestrator.initAgendaStore(agendaFile);

    if (existsSync(stateFile)) {
      console.log(`[Team] Restoring state from ${stateFile}`);
      const mcpDefs = await orchestrator.loadState(stateFile, providerFactory);
      for (const def of mcpDefs) {
        // Always repoint the kanban MCP to the correct project-specific file,
        // in case the saved path is stale (e.g. './kanban-board.json' from root)
        if (def.name === 'kanban' && def.config.transport === 'stdio') {
          const args = (def.config.args ?? []).filter((a: string) => !a.endsWith('.json'));
          def.config.args = [...args, kanbanFile];
        }
        await orchestrator.addMCPServer(def);
      }

      const activeTasks = orchestrator.listTasks().filter(t => t.status === 'active');
      if (activeTasks.length > 0) {
        console.log(`[Team] Resuming ${activeTasks.length} active task(s)…`);
        for (const task of activeTasks) {
          await orchestrator.humanMessage(
            task.assignedTo,
            `You have an active task to continue: ${task.description}${task.context ? `\n\nContext: ${task.context}` : ''}`,
          );
        }
      }
    } else {
      console.log(`[Team] New project at ${projectDir} — assembling fresh team.`);

      // ── Blue Hat leaders — one chosen at random ───────────────────────────
      const blueIdentity = getRandomPersona(HatType.Blue);
      orchestrator.registerAgent({
        identity: blueIdentity,
        hatType: HatType.Blue, provider: claude, model,
      });

      // ── Non-blue agent pool — one per hat, three chosen at random ─────────
      const agentPool = [
        { identity: getRandomPersona(HatType.White),  hatType: HatType.White  },
        { identity: getRandomPersona(HatType.Black),  hatType: HatType.Black  },
        { identity: getRandomPersona(HatType.Yellow), hatType: HatType.Yellow },
        { identity: getRandomPersona(HatType.Green),  hatType: HatType.Green  },
        { identity: getRandomPersona(HatType.Red),    hatType: HatType.Red    },
      ];

      // Shuffle and pick 3 — each has a distinct hat type so the team stays diverse
      for (let i = agentPool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [agentPool[i], agentPool[j]] = [agentPool[j], agentPool[i]];
      }
      const selected = agentPool.slice(0, 3);
      for (const agent of selected) {
        orchestrator.registerAgent({ ...agent, provider: claude, model });
      }

      await orchestrator.addMCPServer({
        name: 'kanban',
        config: {
          transport: 'stdio',
          command: 'node',
          args: ['--import', 'tsx/esm', 'scripts/kanban-mcp.ts', kanbanFile],
        },
      });

      const names = [blueIdentity.name, ...selected.map(a => a.identity.name)].join(' · ');
      console.log(`[Team] Team assembled: ${names}`);
    }

    return orchestrator;
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  await mkdir(PROJECT_DIR, { recursive: true });
  await initCatalogue(CATALOGUE_FILE);

  console.log(`[Team] Project : ${PROJECT_ID}`);
  console.log(`[Team] Folder  : ${PROJECT_DIR}`);

  const loader = makeProjectLoader();
  const orchestrator = await loader(PROJECT_DIR, KANBAN_FILE, STATE_FILE);

  console.log(`[Team] Events → ${EVENTS_FILE}`);
  console.log(`[Team] State  → ${STATE_FILE}  (saved on Ctrl+C)\n`);

  const api = new APIServer(orchestrator, {
    port:           3001,
    kanbanPath:     KANBAN_FILE,
    requestsPath:   REQUESTS_FILE,
    allowlistPath:  ALLOWLIST_FILE,
    mcpEnabledPath: MCP_FILE,
    meetingsPath:   MEETINGS_FILE,
    envPath:        './.env',
    projectId:      PROJECT_ID,
    projectDir:     PROJECT_DIR,
    projectsRoot:   PROJECTS_ROOT,
    projectLoader:  loader,
  });
  api.start();

  process.on('SIGINT', async () => {
    await api.shutdown();
    process.exit(0);
  });

  const blueHat = orchestrator.listAgents().find(a => a.hatType === HatType.Blue);
  const cli = new CLIInterface(orchestrator, blueHat?.name ?? 'Amara', STATE_FILE, providerFactory);

  // Keep the CLI in sync when the API server switches projects
  api.onProjectSwitch((newOrchestrator) => {
    cli.setOrchestrator(newOrchestrator);
  });

  cli.start();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
