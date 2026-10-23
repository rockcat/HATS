import * as path from 'path';
import { runtimeDir } from '@hats/core/runtime-dir';

export const config = {
  name: 'SpeechService',
  version: '1.0.0',
  port: Number(process.env['SPEECH_SERVICE_PORT'] ?? 3050),
  /**
   * Piper voice models. The service spawns one TTS server per model, which is
   * exactly why speech is a service: two processes doing that would fight over
   * the same ports, or double the memory.
   */
  voicesDir: path.resolve(process.env['PIPER_VOICES_DIR'] ?? runtimeDir('piper_voices')),
} as const;
