/**
 * Smoke test: generate avatar + viseme frames, then run a lipsync sequence.
 *
 * Usage:
 *   npx tsx smoke-test.ts
 *
 * Outputs generated images to ./smoke-output/
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { AvatarGenerator } from './src/avatar/generator.js';
import { OpenAITTSProvider } from './src/tts/openai-tts.js';
import { buildVisemeTimeline } from './src/lipsync/scheduler.js';

const OUTPUT_DIR = path.join(process.cwd(), 'smoke-output');
const AGENT_NAME = 'alex';
const AGENT_DESCRIPTION = 'middle aged indian man in a dark blue shirt, friendly expression';
const TEST_SPEECH = 'Hello, I have reviewed the proposal and identified three key risks we should address before proceeding.';

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  // ── Step 1: Generate avatar + viseme frames ──────────────────────────────
  console.log('\n=== Step 1: Avatar Generation ===');
  console.log(`Description: "${AGENT_DESCRIPTION}"`);
  console.log(`Output: ${OUTPUT_DIR}\n`);

  const generator = new AvatarGenerator();
  const assets = await generator.generate({
    name: AGENT_NAME,
    description: AGENT_DESCRIPTION,
    outputDir: OUTPUT_DIR,
  });

  console.log('\n✓ Avatar assets generated:');
  console.log(`  Character:   ${assets.characterDescription.substring(0, 100)}`);
  console.log(`  Base image:  ${assets.baseImagePath}`);
  console.log(`  Viseme frames:`);
  for (const [id, p] of Object.entries(assets.visemeFrames)) {
    const stat = await fs.stat(p);
    console.log(`    ${id.padEnd(6)} → ${path.basename(p)} (${(stat.size / 1024).toFixed(0)} KB)`);
  }

  // ── Step 2: TTS synthesis ────────────────────────────────────────────────
  console.log('\n=== Step 2: TTS Synthesis ===');
  console.log(`Text: "${TEST_SPEECH}"\n`);

  const tts = new OpenAITTSProvider();
  const ttsResult = await tts.synthesise({ text: TEST_SPEECH, voice: 'onyx' });

  const audioPath = path.join(OUTPUT_DIR, `${AGENT_NAME}-speech.mp3`);
  await fs.writeFile(audioPath, ttsResult.audioBuffer);

  console.log(`✓ Audio synthesised:`);
  console.log(`  File:     ${audioPath}`);
  console.log(`  Size:     ${(ttsResult.audioBuffer.length / 1024).toFixed(0)} KB`);
  console.log(`  Duration: ~${(ttsResult.durationMs / 1000).toFixed(1)}s (estimated)`);

  // ── Step 3: Viseme timeline ───────────────────────────────────────────────
  console.log('\n=== Step 3: Viseme Timeline ===');

  const timeline = await buildVisemeTimeline(TEST_SPEECH, ttsResult.durationMs);

  console.log(`✓ Timeline built: ${timeline.length} events over ${(ttsResult.durationMs / 1000).toFixed(1)}s`);
  console.log('\n  First 10 events:');
  for (const event of timeline.slice(0, 10)) {
    console.log(`    t=${String(event.startMs).padStart(4)}ms  ${event.visemeId.padEnd(6)}  (${event.durationMs}ms)`);
  }

  // Viseme distribution
  const counts: Record<string, number> = {};
  for (const e of timeline) counts[e.visemeId] = (counts[e.visemeId] ?? 0) + 1;
  console.log('\n  Viseme distribution:');
  for (const [id, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${id.padEnd(6)} ${count}`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n=== Smoke Test Complete ===');
  console.log(`All outputs saved to: ${OUTPUT_DIR}`);
  console.log('\nNext: open smoke-output/ to review generated images and play the MP3.');
}

main().catch((err) => {
  console.error('\n✗ Smoke test failed:', err);
  process.exit(1);
});
