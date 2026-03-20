/**
 * Team demo — 6 hat agents with real names + human CLI
 *
 * Usage:
 *   node --env-file=.env --import tsx/esm team-demo.ts
 *
 * State is saved to team-state.json on exit (Ctrl+C) and restored on next run.
 * Delete team-state.json to start fresh.
 */

import { existsSync } from 'fs';
import { TeamOrchestrator } from './src/orchestrator/orchestrator.js';
import { CLIInterface } from './src/human/cli-interface.js';
import { APIServer } from './src/api/api-server.js';
import { AnthropicProvider } from './src/providers/anthropic.js';
import { HatType } from './src/hats/types.js';

const STATE_FILE = './team-state.json';

async function main() {
  const orchestrator = new TeamOrchestrator({
    storePath: './team-events.jsonl',
    humanName: 'Boss',
  });
  await orchestrator.init();

  const claude = new AnthropicProvider();
  const model = 'claude-sonnet-4-6';

  // ── Restore or assemble ──────────────────────────────────────────────────
  if (existsSync(STATE_FILE)) {
    const mcpDefs = await orchestrator.loadState(STATE_FILE, (providerName) => {
      if (providerName === 'anthropic') return claude;
      throw new Error(`Unknown provider in snapshot: "${providerName}"`);
    });
    // Reconnect MCP servers that were active when state was saved
    for (const def of mcpDefs) {
      await orchestrator.addMCPServer(def);
    }
  } else {
    console.log('[Team] No saved state — assembling fresh team.\n');

    orchestrator.registerAgent({
      identity: {
        name: 'Jordan',
        visualDescription: 'calm, organised, middle-aged professional in a navy blazer',
        specialisation: 'project coordination and facilitation',
        backstory: 'Ten years running cross-functional teams at a management consultancy.',
      },
      hatType: HatType.Blue,
      provider: claude,
      model,
    });

    orchestrator.registerAgent({
      identity: {
        name: 'Morgan',
        visualDescription: 'precise, analytical, mid-thirties with reading glasses',
        specialisation: 'data gathering and research',
        backstory: 'Former data analyst, obsessed with sources and evidence quality.',
      },
      hatType: HatType.White,
      provider: claude,
      model,
    });

    orchestrator.registerAgent({
      identity: {
        name: 'Alex',
        visualDescription: 'serious, direct, sharp eyes that miss nothing',
        specialisation: 'risk assessment and critical analysis',
        backstory: 'Ex-auditor who spent a decade finding what could go wrong before it did.',
      },
      hatType: HatType.Black,
      provider: claude,
      model,
    });

    orchestrator.registerAgent({
      identity: {
        name: 'Sam',
        visualDescription: 'warm, enthusiastic, always leaning forward',
        specialisation: 'opportunity identification and positive outcomes',
        backstory: 'Serial optimist who has founded two startups and genuinely believes things work out.',
      },
      hatType: HatType.Yellow,
      provider: claude,
      model,
    });

    orchestrator.registerAgent({
      identity: {
        name: 'River',
        visualDescription: 'creative, lateral-thinking, colourful and a little unpredictable',
        specialisation: 'creative solutions and idea generation',
        backstory: 'Trained as a designer, thinks in metaphors, never accepts "that\'s just how it\'s done".',
      },
      hatType: HatType.Green,
      provider: claude,
      model,
    });

    orchestrator.registerAgent({
      identity: {
        name: 'Casey',
        visualDescription: 'empathetic, intuitive, quietly observant',
        specialisation: 'team dynamics, sentiment, and stakeholder perspective',
        backstory: 'Spent years in organisational psychology before joining business teams.',
      },
      hatType: HatType.Red,
      provider: claude,
      model,
    });

    // Connect kanban board as an MCP tool server
    await orchestrator.addMCPServer({
      name: 'kanban',
      config: {
        transport: 'stdio',
        command: 'node',
        args: ['--import', 'tsx/esm', 'scripts/kanban-mcp.ts', './kanban-board.json'],
      },
    });

    console.log('Team assembled:');
    console.log('  Jordan (Blue Hat) — project coordination');
    console.log('  Morgan (White Hat) — research & data');
    console.log('  Alex   (Black Hat) — risk & critique');
    console.log('  Sam    (Yellow Hat) — opportunities');
    console.log('  River  (Green Hat) — creative ideas');
    console.log('  Casey  (Red Hat)   — people & sentiment');
  }

  console.log('\nEvents logged to team-events.jsonl');
  console.log(`State will be saved to ${STATE_FILE} on exit (Ctrl+C)\n`);

  // ── API server ────────────────────────────────────────────────────────────
  const api = new APIServer(orchestrator, {
    port: 3001,
    kanbanPath: './kanban-board.json',
  });
  api.start();

  process.on('SIGINT', async () => {
    api.stop();
    await orchestrator.shutdown(STATE_FILE);
    process.exit(0);
  });

  // Default: messages go to Jordan (Blue Hat / PM)
  const cli = new CLIInterface(orchestrator, 'Jordan');
  cli.start();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
