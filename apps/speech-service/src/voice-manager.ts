/**
 * Discovers Piper voice models and spawns a piper.http_server Flask instance
 * for each one so the model stays loaded in memory between requests.
 *
 * Environment variables:
 *   PIPER_VOICES_DIR         directory containing .onnx files.
 *                            Defaults to the directory of PIPER_MODEL if not set.
 *   PYTHON_BIN               python executable (default: "python").
 *   PIPER_SERVER_PORT_START  first port to bind (default: 5100).
 *
 * Each server is started with:
 *   python -m piper.http_server -m <model_path> --port <port>
 */
import { spawn, ChildProcess } from 'child_process';
import { readdir } from 'fs/promises';
import * as path from 'path';
import { log } from '../../../packages/core/src/logger.js';
import { readSpeakers, resolveVoicesDir } from '../../../packages/speech-core/src/voice-models.js';
import type { RunningVoice } from '../../../packages/speech-core/src/types.js';

/** A voice this manager has started, and where to reach it. */
export type PiperVoice = RunningVoice;

const DEFAULT_PORT_START = 5100;
const READY_TIMEOUT_MS   = 30_000;

export class VoiceManager {
  private voices: PiperVoice[] = [];
  private procs = new Map<string, ChildProcess>();

  async start(): Promise<void> {
    const voicesDir = resolveVoicesDir();
    if (!voicesDir) return;

    const python    = process.env['PYTHON_BIN'] ?? 'python';
    const portStart = parseInt(process.env['PIPER_SERVER_PORT_START'] ?? String(DEFAULT_PORT_START), 10);

    let files: string[];
    try {
      files = (await readdir(voicesDir))
        .filter(f => f.endsWith('.onnx') && !f.endsWith('.onnx.json'))
        .sort();
    } catch (err) {
      log.warn(`[VoiceManager] Cannot read voices dir "${voicesDir}":`, (err as Error).message);
      return;
    }

    if (files.length === 0) {
      log.warn(`[VoiceManager] No .onnx files found in "${voicesDir}"`);
      return;
    }

    const readyPromises: Promise<void>[] = [];

    for (let i = 0; i < files.length; i++) {
      const file      = files[i];
      const name      = file.replace(/\.onnx$/, '');
      const modelPath = path.join(voicesDir, file);
      const port      = portStart + i;
      const url       = `http://localhost:${port}`;

      const { speakerId, speakers } = await readSpeakers(`${modelPath}.json`);
      if (speakers.length > 0)
        log.info(`[VoiceManager] "${name}" is multi-speaker (${speakers.length} speakers) — default: "${speakerId}"`);
      log.info(`[VoiceManager] Starting "${name}" on port ${port}`);

      const proc = spawn(
        python,
        ['-m', 'piper.http_server', '-m', modelPath, '--port', String(port)],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );

      proc.stdout?.on('data', (d: Buffer) => process.stdout.write(`[Piper:${name}] ${d}`));
      proc.stderr?.on('data', (d: Buffer) => process.stderr.write(`[Piper:${name}] ${d}`));
      proc.on('exit', (code) => {
        if (code !== null && code !== 0)
          log.warn(`[VoiceManager] "${name}" exited ${code}`);
        this.procs.delete(name);
        this.voices = this.voices.filter(v => v.name !== name);
      });

      this.voices.push({ name, file, modelPath, port, url, speakerId, speakers });
      this.procs.set(name, proc);
      readyPromises.push(this.waitForServer(url, name));
    }

    await Promise.all(readyPromises);
    log.info(`[VoiceManager] ${this.voices.length} voice(s) ready`);
  }

  stop(): void {
    for (const [name, proc] of this.procs) {
      log.info(`[VoiceManager] Stopping "${name}"`);
      proc.kill();
    }
    this.procs.clear();
    this.voices = [];
  }

  getVoices(): PiperVoice[] { return [...this.voices]; }

  getVoiceByName(name: string): PiperVoice | undefined {
    return this.voices.find(v => v.name === name);
  }

  getDefaultVoice(): PiperVoice | undefined { return this.voices[0]; }

  resolveVoice(preferred: string | undefined): PiperVoice | undefined {
    if (!preferred) return this.getDefaultVoice();
    const v = this.getVoiceByName(preferred);
    if (v) return v;
    const fallback = this.getDefaultVoice();
    if (fallback)
      log.warn(`[VoiceManager] Voice "${preferred}" not available — falling back to "${fallback.name}"`);
    return fallback;
  }

  // ── Private ─────────────────────────────────────────────────────────────────



  private async waitForServer(url: string, name: string): Promise<void> {
    const voice   = this.voices.find(v => v.name === name);
    const body: Record<string, unknown> = { text: 'test' };
    if (voice?.speakerId !== null && voice?.speakerId !== undefined)
      body['speaker_id'] = voice.speakerId;

    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        await fetch(`${url}/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(2000),
        });
        log.info(`[VoiceManager] "${name}" ready`);
        return;
      } catch {
        await new Promise(r => setTimeout(r, 500));
      }
    }
    log.warn(`[VoiceManager] "${name}" did not respond within ${READY_TIMEOUT_MS}ms`);
  }


}
