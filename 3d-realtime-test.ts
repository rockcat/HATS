/**
 * 3D realtime lipsync test — Robinson Crusoe opening
 * Renders a 3D head with lip sync, outputs via NDI + SRT simultaneously.
 *
 * Usage:
 *   1. node --env-file=.env --import tsx/esm setup-3d.ts   (once)
 *   2. node --env-file=.env --import tsx/esm 3d-realtime-test.ts
 *
 * OBS: Add Media Source → URL: srt://localhost:9000
 * NDI receivers will see "Personality Agent" automatically.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { HeadlessRenderer } from './src/renderer3d/headless-renderer.js';
import { HeadScene } from './src/renderer3d/head-scene.js';
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
  // Load manifest
  const manifestPath = path.join(process.cwd(), 'assets-3d', 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8')) as {
    modelPath: string;
    texturePath: string;
    faceBounds?: { top: number; bottom: number; left: number; right: number };
  };

  console.log('Initialising 3D renderer...');
  const renderer = new HeadlessRenderer({ width: WIDTH, height: HEIGHT });
  const scene = new HeadScene(renderer);

  await scene.loadModel({
    modelPath: manifest.modelPath,
    texturePath: manifest.texturePath,
    faceBounds: manifest.faceBounds,
    width: WIDTH,
    height: HEIGHT,
  });
  console.log('Model loaded.');

  // Start media server (NDI + SRT + SDL viewer with mouse rotation)
  const mediaServer = new MediaServer({
    sourceName: 'Personality Agent',
    viewer: {
      onMouseDrag: (dx, dy) => scene.addRotation(dx, dy),
    },
  });
  mediaServer.start();
  console.log('Media server started.');

  // Idle render loop — keeps the stream alive between sentences
  let idleInterval: ReturnType<typeof setInterval> | null = setInterval(() => {
    const frame = scene.renderFrame();
    mediaServer.pushFrame(frame, WIDTH, HEIGHT, FPS);
  }, 1000 / FPS);

  const stopIdle = () => { if (idleInterval) { clearInterval(idleInterval); idleInterval = null; } };
  const startIdle = () => {
    if (!idleInterval) {
      idleInterval = setInterval(() => {
        const frame = scene.renderFrame();
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
    const [ttsResult, timeline] = await Promise.all([
      tts.synthesise({ text, voice: 'onyx' }),
      buildVisemeTimeline(text),
    ]);
    const scaledTimeline = await buildVisemeTimeline(text, ttsResult.durationMs);

    // Save audio to temp file and play via ffplay
    const tmpAudio = path.join(os.tmpdir(), `3d-lipsync-${Date.now()}.mp3`);
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
        const viseme = getVisemeAt(scaledTimeline, elapsed);
        scene.setViseme(viseme);
        const frame = scene.renderFrame();
        mediaServer.pushFrame(frame, WIDTH, HEIGHT, FPS);

        if (elapsed >= ttsResult.durationMs + 300) {
          clearInterval(interval);
          resolve();
        }
      }, 1000 / FPS);
    });

    // Clean up temp audio
    fs.unlink(tmpAudio).catch(() => {});
    scene.setViseme('rest');

    // Brief pause between sentences
    await delay(400);
  }

  // Resume idle, wait a moment, then clean up
  startIdle();
  console.log('\nNarration complete.');
  await delay(3000);

  stopIdle();
  mediaServer.stop();
  renderer.dispose();
  process.exit(0);
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => { console.error(err); process.exit(1); });
