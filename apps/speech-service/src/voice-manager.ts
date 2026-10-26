/**
 * Discovers Piper voice models and spawns a piper.http_server Flask instance
 * for each one so the model stays loaded in memory between requests.
 *
 * Voices can also be added and removed while the service runs — the voices
 * page installs one from the Piper catalogue and starts it here, without a
 * restart.
 *
 * Environment variables:
 *   PYTHON_BIN               python executable (default: "python").
 *   PIPER_SERVER_PORT_START  first port to bind (default: 5100).
 *
 * Each server is started with:
 *   python -m piper.http_server -m <model_path> --port <port>
 */
import { spawn, ChildProcess } from 'child_process';
import { mkdir, readdir, rm } from 'fs/promises';
import * as path from 'path';
import { log } from '@hats/core/logger';
import { readSpeakers } from '@hats/speech-core/voice-models';
import type { RunningVoice } from '@hats/speech-core/types';

/** A voice this manager has started, and where to reach it. */
export type PiperVoice = RunningVoice;

const DEFAULT_PORT_START = 5100;
const READY_TIMEOUT_MS   = 30_000;

export class VoiceManager {
  private voices: PiperVoice[] = [];
  private procs = new Map<string, ChildProcess>();
  private readonly python    = process.env['PYTHON_BIN'] ?? 'python';
  private readonly portStart = parseInt(process.env['PIPER_SERVER_PORT_START'] ?? String(DEFAULT_PORT_START), 10);

  constructor(readonly voicesDir: string) {}

  async start(): Promise<void> {
    let files: string[];
    try {
      files = (await readdir(this.voicesDir))
        .filter(f => f.endsWith('.onnx'))
        .sort();
    } catch (err) {
      log.warn(`[VoiceManager] Cannot read voices dir "${this.voicesDir}":`, (err as Error).message);
      return;
    }

    if (files.length === 0) {
      log.warn(`[VoiceManager] No .onnx files found in "${this.voicesDir}"`);
      return;
    }

    await Promise.all(files.map((file) => this.startVoice(file)));
    log.info(`[VoiceManager] ${this.voices.length} voice(s) ready`);
  }

  /** Start a voice whose files are already in the voices folder. */
  async add(name: string): Promise<PiperVoice> {
    const existing = this.getVoiceByName(name);
    if (existing) return existing;
    await this.startVoice(`${name}.onnx`);
    const voice = this.getVoiceByName(name);
    if (!voice) throw new Error(`"${name}" did not start — see the service log`);
    return voice;
  }

  /** Stop a voice and delete its files. */
  async remove(name: string): Promise<void> {
    const proc = this.procs.get(name);
    if (proc) {
      log.info(`[VoiceManager] Stopping "${name}"`);
      proc.kill();
    }
    this.procs.delete(name);
    this.voices = this.voices.filter(v => v.name !== name);
    for (const ext of ['.onnx', '.onnx.json']) {
      await rm(path.join(this.voicesDir, `${name}${ext}`), { force: true });
    }
    log.info(`[VoiceManager] Removed "${name}"`);
  }

  /** Make sure the folder exists, so a download has somewhere to land. */
  async ensureDir(): Promise<void> {
    await mkdir(this.voicesDir, { recursive: true });
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

  /** The lowest port from the start that no running voice holds. */
  private freePort(): number {
    const used = new Set(this.voices.map(v => v.port));
    let port = this.portStart;
    while (used.has(port)) port++;
    return port;
  }

  private async startVoice(file: string): Promise<void> {
    const name      = file.replace(/\.onnx$/, '');
    const modelPath = path.join(this.voicesDir, file);

    const { speakerId, speakers } = await readSpeakers(`${modelPath}.json`);
    // From here to the push below is synchronous. Voices start in parallel,
    // so the port must be taken and recorded with no await in between, or
    // every voice would pick the same one.
    const port = this.freePort();
    const url  = `http://localhost:${port}`;
    if (speakers.length > 0)
      log.info(`[VoiceManager] "${name}" is multi-speaker (${speakers.length} speakers) — default: "${speakerId}"`);
    log.info(`[VoiceManager] Starting "${name}" on port ${port}`);

    const proc = spawn(
      this.python,
      ['-m', 'piper.http_server', '-m', modelPath, '--port', String(port)],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    proc.stdout?.on('data', (d: Buffer) => process.stdout.write(`[Piper:${name}] ${d}`));
    proc.stderr?.on('data', (d: Buffer) => process.stderr.write(`[Piper:${name}] ${d}`));
    proc.on('exit', (code) => {
      if (code !== null && code !== 0)
        log.warn(`[VoiceManager] "${name}" exited ${code}`);
      // Only if it is still this process: a voice removed and installed
      // again has a new one, which this old exit must not take down.
      if (this.procs.get(name) === proc) {
        this.procs.delete(name);
        this.voices = this.voices.filter(v => v.name !== name);
      }
    });

    this.voices.push({ name, file, modelPath, port, url, speakerId, speakers });
    this.procs.set(name, proc);
    await this.waitForServer(url, name);
  }

  private async waitForServer(url: string, name: string): Promise<void> {
    const voice   = this.voices.find(v => v.name === name);
    const body: Record<string, unknown> = { text: 'test' };
    if (voice?.speakerId !== null && voice?.speakerId !== undefined)
      body['speaker_id'] = voice.speakerId;

    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (!this.procs.has(name)) return; // it exited; the exit handler said why
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
