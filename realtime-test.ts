/**
 * Realtime lipsync test — Robinson Crusoe opening paragraph
 * Outputs via NDI + SRT simultaneously.
 *
 * Usage:
 *   1. node --env-file=.env --import tsx/esm smoke-test.ts   (once, to generate assets)
 *   2. node --env-file=.env --import tsx/esm realtime-test.ts
 *
 * OBS: Add Media Source → URL: srt://localhost:9000
 * NDI receivers will see "Personality Agent" automatically.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { AvatarAssets } from './src/avatar/types.js';
import { CanvasRenderer } from './src/render/canvas-renderer.js';
import { MediaServer } from './src/media/media-server.js';
import { OpenAITTSProvider } from './src/tts/openai-tts.js';
import { buildVisemeTimeline, getVisemeAt } from './src/lipsync/scheduler.js';

const FPS = 25;
const WIDTH = 512;
const HEIGHT = 512;

const SENTENCES = [
  'I was born in the year 1632, in the city of York, of a good family, though not of that country, my father being a foreigner of Bremen, who settled first at Hull.',
  'He got a good estate by merchandise, and leaving off his trade, lived afterwards at York, from whence he had married my mother, whose relations were named Robinson, a very good family in that country, and from whom I was called Robinson Kreutznaer.',
  'But by the usual corruption of words in England, we are now called — nay, we call ourselves, and write our name — Crusoe; and so my companions always called me.',
  'I had two elder brothers, one of whom was lieutenant-colonel to an English regiment of foot in Flanders, and was killed at the battle near Dunkirk against the Spaniards.',
  'Being the third son of the family, and not bred to any trade, my head began to be filled very early with rambling thoughts.',
];

async function main() {
  // Load avatar assets
  const manifestPath = path.join(process.cwd(), 'smoke-output', 'alex-manifest.json');
  const assets: AvatarAssets = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
  console.log(`Loaded avatar: ${assets.name}`);

  // Init renderer
  const renderer = new CanvasRenderer({ width: WIDTH, height: HEIGHT, fps: FPS });
  await renderer.loadAssets(assets);
  console.log('Assets loaded.');

  // Start media server (NDI + SRT + SDL viewer)
  const mediaServer = new MediaServer({ sourceName: 'Personality Agent' });
  mediaServer.start();
  console.log('Media server started.');

  // Idle render loop — keeps the stream alive between sentences
  let idleInterval: ReturnType<typeof setInterval> | null = setInterval(() => {
    const frame = renderer.renderFrame();
    mediaServer.pushFrame(frame, WIDTH, HEIGHT, FPS);
  }, 1000 / FPS);

  const stopIdle = () => { if (idleInterval) { clearInterval(idleInterval); idleInterval = null; } };
  const startIdle = () => {
    if (!idleInterval) {
      idleInterval = setInterval(() => {
        const frame = renderer.renderFrame();
        mediaServer.pushFrame(frame, WIDTH, HEIGHT, FPS);
      }, 1000 / FPS);
    }
  };

  const tts = new OpenAITTSProvider();

  console.log('\nStarting narration (Robinson Crusoe)...\n');

  for (let i = 0; i < SENTENCES.length; i++) {
    const text = SENTENCES[i]!;
    console.log(`[${i + 1}/${SENTENCES.length}] ${text.substring(0, 70)}...`);

    // TTS + viseme timeline in parallel
    const [ttsResult] = await Promise.all([
      tts.synthesise({ text, voice: 'onyx' }),
      buildVisemeTimeline(text), // warm cache
    ]);
    const timeline = await buildVisemeTimeline(text, ttsResult.durationMs);

    // Save audio to temp file and play via ffplay
    const tmpAudio = path.join(os.tmpdir(), `lipsync-${Date.now()}.mp3`);
    await fs.writeFile(tmpAudio, ttsResult.audioBuffer);
    const player = spawn('ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet', tmpAudio], {
      stdio: 'ignore',
    });
    player.on('error', () => { /* ffplay not available */ });

    // Stop idle loop, drive render loop for this sentence
    stopIdle();
    const startTime = Date.now();

    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const viseme = getVisemeAt(timeline, elapsed);
        renderer.setViseme(viseme);
        const frame = renderer.renderFrame();
        mediaServer.pushFrame(frame, WIDTH, HEIGHT, FPS);

        if (elapsed >= ttsResult.durationMs + 300) {
          clearInterval(interval);
          resolve();
        }
      }, 1000 / FPS);
    });

    fs.unlink(tmpAudio).catch(() => {});
    renderer.setViseme('rest');

    // Brief pause between sentences
    startIdle();
    await delay(400);
  }

  // Resume idle, wait a moment, then clean up
  console.log('\nNarration complete.');
  await delay(3000);

  stopIdle();
  mediaServer.stop();
  process.exit(0);
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => { console.error(err); process.exit(1); });
