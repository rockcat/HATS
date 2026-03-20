/**
 * Team demo — 6 hat agents with real names + human CLI
 *
 * Usage:
 *   node --env-file=.env --import tsx/esm team-demo.ts
 */

import { TeamOrchestrator } from './src/orchestrator/orchestrator.js';
import { CLIInterface } from './src/human/cli-interface.js';
import { AnthropicProvider } from './src/providers/anthropic.js';
import { HatType } from './src/hats/types.js';

async function main() {
  const orchestrator = new TeamOrchestrator({
    storePath: './team-events.jsonl',
    humanName: 'Boss',
  });
  await orchestrator.init();

  const claude = new AnthropicProvider();
  const model = 'claude-sonnet-4-6';

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

  console.log('\nTeam assembled:');
  console.log('  Jordan (Blue Hat) — project coordination');
  console.log('  Morgan (White Hat) — research & data');
  console.log('  Alex   (Black Hat) — risk & critique');
  console.log('  Sam    (Yellow Hat) — opportunities');
  console.log('  River  (Green Hat) — creative ideas');
  console.log('  Casey  (Red Hat)   — people & sentiment');
  console.log('\nEvents logged to team-events.jsonl\n');

  // Default: messages go to Jordan (Blue Hat / PM)
  const cli = new CLIInterface(orchestrator, 'Jordan');
  cli.start();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
