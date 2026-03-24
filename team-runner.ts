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
import { OpenAIProvider } from './src/providers/openai.js';
import { GeminiProvider } from './src/providers/gemini.js';
import { HatType } from './src/hats/types.js';

// ── Project layout ────────────────────────────────────────────────────────────

const PROJECTS_ROOT = path.resolve(process.env['PROJECTS_ROOT'] ?? './projects');
const PROJECT_ID    = process.argv[2] ?? process.env['TEAM_PROJECT'] ?? 'default';
const PROJECT_DIR   = path.join(PROJECTS_ROOT, PROJECT_ID);

const STATE_FILE    = path.join(PROJECT_DIR, 'team-state.json');
const EVENTS_FILE   = path.join(PROJECT_DIR, 'team-events.jsonl');
const KANBAN_FILE   = path.join(PROJECT_DIR, 'kanban-board.json');
const MCP_FILE      = path.join(PROJECT_DIR, 'mcp-enabled.json');
const MEETINGS_FILE = path.join(PROJECT_DIR, 'meetings.json');

// ── Provider factory ──────────────────────────────────────────────────────────

const claude = new AnthropicProvider();
const model  = process.env['ANTHROPIC_MODEL'] ?? 'claude-haiku-4-5-20251001';

function providerFactory(name: string) {
  if (name === 'anthropic') return claude;
  if (name === 'openai')    return new OpenAIProvider();
  if (name === 'gemini')    return new GeminiProvider();
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
    await orchestrator.init();
    await orchestrator.initMeetingStore(meetingsFile);

    if (existsSync(stateFile)) {
      console.log(`[Team] Restoring state from ${stateFile}`);
      const mcpDefs = await orchestrator.loadState(stateFile, providerFactory);
      for (const def of mcpDefs) await orchestrator.addMCPServer(def);

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

      orchestrator.registerAgent({
        identity: {
          name: 'Jordan',
          visualDescription: 'calm, organised, middle-aged professional in a navy blazer',
          specialisation: 'project coordination and facilitation',
          backstory: 'Ten years running cross-functional teams at a management consultancy.',
        },
        hatType: HatType.Blue, provider: claude, model,
      });
      orchestrator.registerAgent({
        identity: {
          name: 'Morgan',
          visualDescription: 'precise, analytical, mid-thirties with reading glasses',
          specialisation: 'data gathering and research',
          backstory: 'Former data analyst, obsessed with sources and evidence quality.',
        },
        hatType: HatType.White, provider: claude, model,
      });
      orchestrator.registerAgent({
        identity: {
          name: 'Alex',
          visualDescription: 'serious, direct, sharp eyes that miss nothing',
          specialisation: 'risk assessment and critical analysis',
          backstory: 'Ex-auditor who spent a decade finding what could go wrong before it did.',
        },
        hatType: HatType.Black, provider: claude, model,
      });
      orchestrator.registerAgent({
        identity: {
          name: 'Sam',
          visualDescription: 'warm, enthusiastic, always leaning forward',
          specialisation: 'opportunity identification and positive outcomes',
          backstory: 'Serial optimist who has founded two startups and genuinely believes things work out.',
        },
        hatType: HatType.Yellow, provider: claude, model,
      });
      orchestrator.registerAgent({
        identity: {
          name: 'River',
          visualDescription: 'creative, lateral-thinking, colourful and a little unpredictable',
          specialisation: 'creative solutions and idea generation',
          backstory: "Trained as a designer, thinks in metaphors, never accepts \"that's just how it's done\".",
        },
        hatType: HatType.Green, provider: claude, model,
      });
      orchestrator.registerAgent({
        identity: {
          name: 'Casey',
          visualDescription: 'empathetic, intuitive, quietly observant',
          specialisation: 'team dynamics, sentiment, and stakeholder perspective',
          backstory: 'Spent years in organisational psychology before joining business teams.',
        },
        hatType: HatType.Red, provider: claude, model,
      });

      await orchestrator.addMCPServer({
        name: 'kanban',
        config: {
          transport: 'stdio',
          command: 'node',
          args: ['--import', 'tsx/esm', 'scripts/kanban-mcp.ts', kanbanFile],
        },
      });

      console.log('[Team] Team assembled: Jordan · Morgan · Alex · Sam · River · Casey');
    }

    return orchestrator;
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  await mkdir(PROJECT_DIR, { recursive: true });

  console.log(`[Team] Project : ${PROJECT_ID}`);
  console.log(`[Team] Folder  : ${PROJECT_DIR}`);

  const loader = makeProjectLoader();
  const orchestrator = await loader(PROJECT_DIR, KANBAN_FILE, STATE_FILE);

  console.log(`[Team] Events → ${EVENTS_FILE}`);
  console.log(`[Team] State  → ${STATE_FILE}  (saved on Ctrl+C)\n`);

  const api = new APIServer(orchestrator, {
    port:           3001,
    kanbanPath:     KANBAN_FILE,
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

  const cli = new CLIInterface(orchestrator, 'Jordan', STATE_FILE, providerFactory);
  cli.start();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
