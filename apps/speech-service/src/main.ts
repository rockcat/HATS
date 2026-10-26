/**
 * HATS Speech Service.
 *
 * Owns text-to-speech: it discovers the Piper voice models, spawns one TTS
 * server per model, and renders text to audio with Rhubarb viseme timings.
 *
 * Speech is a service rather than a library because it runs processes. Piper
 * binds a port per voice, so two hosts doing this would collide or double the
 * memory. Anything that wants audio asks here instead of spawning its own.
 *
 * Start it with `npm run speech-service`.
 */

import * as path from 'path';
import { fileURLToPath } from 'url';
import { startService } from '@hats/service-kit/index';
import { uiKitMount } from '../../../packages/ui-kit/index.js';
import { config } from './config.js';
import { speechRoutes } from './routes.js';
import { isSpeechAvailable } from './pipeline.js';
import { VoiceManager } from './voice-manager.js';
import { VoiceCatalogue } from './voice-catalogue.js';
import { voiceAdminRoutes } from './voice-admin-routes.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

async function main(): Promise<void> {
  const voices = new VoiceManager(config.voicesDir);
  // Spawning is slow, so it runs in the background; the service answers
  // immediately and reports however many voices are ready so far.
  voices.start().catch((err: Error) => console.warn(`[${config.name}] voice startup:`, err.message));

  await startService({
    name: config.name,
    port: config.port,
    publicDir: PUBLIC_DIR,
    mounts: [uiKitMount()],
    routes: [...speechRoutes(voices), ...voiceAdminRoutes(voices, new VoiceCatalogue(config.catalogueUrl))],
    banner: [
      `voices page: http://localhost:${config.port}/`,
      `voices:    ${config.voicesDir}`,
      `synthesis: POST http://localhost:${config.port}/api/v1/speech  (NDJSON, one chunk per sentence)`,
    ],
    onShutdown: () => voices.stop(),
  });

  // Report once the models have finished coming up.
  setTimeout(() => {
    const ready = voices.getVoices();
    console.log(ready.length > 0
      ? `[${config.name}] ${ready.length} voice(s) ready: ${ready.map((v) => v.name).join(', ')}`
      : `[${config.name}] no voice models found in ${config.voicesDir} — synthesis will be unavailable`);
  }, 2000).unref?.();
}

main().catch((err) => {
  console.error(`[${config.name}] failed to start:`, err);
  process.exit(1);
});
