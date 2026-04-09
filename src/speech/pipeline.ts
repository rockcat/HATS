/**
 * Speech synthesis pipeline: text → Piper TTS → Rhubarb visemes → SpeechChunk
 *
 * Environment variables:
 *   PIPER_MODEL         Path to the .onnx voice model (required to enable TTS).
 *   PIPER_BIN           piper executable (default: "piper").
 *   RHUBARB_BIN         rhubarb executable (default: "rhubarb").
 *   RHUBARB_RECOGNIZER  "phonetic" (default) or "pocketSphinx".
 */
import { spawn } from 'child_process';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile, unlink, writeFile } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { VisemeEvent, SpeechChunk } from './types.js';
import { RHUBARB_TO_ARKIT } from './rhubarb-map.js';
import { log } from '../util/logger.js';

const execFileAsync = promisify(execFile);

// ── Text preprocessing ────────────────────────────────────────────────────────

/** Strip common Markdown formatting so TTS reads clean text. */
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')           // fenced code blocks
    .replace(/`[^`]+`/g, ' ')                   // inline code
    .replace(/\*\*(.*?)\*\*/g, '$1')            // bold
    .replace(/\*(.*?)\*/g, '$1')                // italic
    .replace(/__(.*?)__/g, '$1')                // underline bold
    .replace(/_(.*?)_/g, '$1')                  // underline italic
    .replace(/~~(.*?)~~/g, '$1')               // strikethrough
    .replace(/^#{1,6}\s+/gm, '')               // ATX headings
    .replace(/^[-*+]\s+/gm, '')                // unordered lists
    .replace(/^\d+\.\s+/gm, '')                // ordered lists
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')   // links → label
    .replace(/!\[.*?\]\([^)]+\)/g, '')         // images
    .replace(/[|\\]/g, ' ')                    // table pipes, backslashes
    .replace(/^[-─═*_~]{3,}\s*$/gm, '')        // horizontal rules / dividers
    .replace(/[\u{1F300}-\u{1FFFF}]/gu, '')    // emoji (most ranges)
    .replace(/[\u2600-\u27BF]/g, '')           // misc symbols, dingbats
    .replace(/[\u{E0000}-\u{E007F}]/gu, '')    // tags block
    .replace(/\s{2,}/g, ' ');                  // collapse extra whitespace
}

/** Split text into speakable sentences. */
export function splitSentences(text: string): string[] {
  const plain = stripMarkdown(text);
  return plain
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map(s => s.trim().replace(/\s+/g, ' '))
    .filter(s => s.length > 3 && /[a-zA-Z]/.test(s));
}

// ── WAV header ────────────────────────────────────────────────────────────────

function buildWavBuffer(pcm: Buffer, sampleRate: number): Buffer {
  const numChannels  = 1;
  const bitsPerSample = 16;
  const byteRate     = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign   = numChannels * (bitsPerSample / 8);

  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);              // PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

/** Read sample rate from the model's companion .onnx.json config. */
async function getModelSampleRate(modelPath: string): Promise<number> {
  try {
    const config = JSON.parse(await readFile(modelPath + '.json', 'utf-8'));
    const rate = config?.audio?.sample_rate as number | undefined;
    if (rate) {
      log.info(`[Speech] Model sample rate: ${rate} Hz`);
      return rate;
    }
  } catch {
    // fall through
  }
  log.warn('[Speech] Could not read model sample rate — defaulting to 22050 Hz');
  return 22050;
}

// ── Piper TTS ─────────────────────────────────────────────────────────────────

// Sample rates cached per model path to avoid re-reading .onnx.json files.
const sampleRateCache = new Map<string, number>();

async function resolvedSampleRate(modelPath: string): Promise<number> {
  if (sampleRateCache.has(modelPath)) return sampleRateCache.get(modelPath)!;
  const rate = await getModelSampleRate(modelPath);
  sampleRateCache.set(modelPath, rate);
  return rate;
}

/**
 * Server mode: GET from a running piper.http_server Flask instance.
 * The server is started with: python -m piper.http_server -m <model> --port <port>
 * Returns a WAV buffer directly — no header construction needed.
 */
async function runPiperServer(text: string, serverUrl: string, speakerId: number | null): Promise<Buffer> {
  log.info(`[Speech] Piper server POST ${serverUrl} "${text.slice(0, 60)}"`);
  const payload: Record<string, unknown> = { text };
  if (speakerId !== null) payload['speaker_id'] = speakerId;
  const res = await fetch(`${serverUrl}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Piper server ${res.status}: ${body.slice(0, 200)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  log.info(`[Speech] Piper server done — ${buf.length} bytes`);
  return buf;
}

/**
 * Subprocess mode: spawn the piper CLI with --output-raw for the given model,
 * collect PCM from stdout and return a WAV Buffer.
 * Used when no HTTP server is available (PIPER_MODEL env var).
 */
async function runPiperProcess(text: string, modelPath: string, sampleRate: number): Promise<Buffer> {
  const piperBin = process.env['PIPER_BIN'] ?? 'piper';

  log.info(`[Speech] Piper "${path.basename(modelPath)}" — "${text.slice(0, 60)}"`);

  return new Promise((resolve, reject) => {
    const child = spawn(piperBin, ['--model', modelPath, '--output-raw'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const pcmChunks: Buffer[] = [];
    let stderr = '';

    child.stdout.on('data', (d: Buffer) => pcmChunks.push(d));
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

    child.stdin.write(text, 'utf-8');
    child.stdin.end();

    child.on('exit', (code) => {
      if (code === 0) {
        const pcm = Buffer.concat(pcmChunks);
        log.info(`[Speech] Piper done — ${pcm.length} PCM bytes`);
        resolve(buildWavBuffer(pcm, sampleRate));
      } else {
        log.error(`[Speech] Piper failed (exit ${code}):\n${stderr}`);
        reject(new Error(`piper exited ${code}: ${stderr.slice(0, 400)}`));
      }
    });
    child.on('error', (err) => {
      log.error(`[Speech] Piper spawn error:`, err.message);
      reject(err);
    });
  });
}

// ── Rhubarb viseme extraction ─────────────────────────────────────────────────

async function runRhubarb(wavFile: string, dialogueFile: string, jsonFile: string): Promise<void> {
  const rhubarbBin = process.env['RHUBARB_BIN'] ?? 'rhubarb';
  const recognizer = process.env['RHUBARB_RECOGNIZER'] ?? 'phonetic';

  const args = [
    '-f', 'json',
    '--recognizer', recognizer,
    '-d', dialogueFile,   // file path — Rhubarb expects a file, not inline text
    '-o', jsonFile,
    wavFile,
    '--quiet',
  ];

  log.info(`[Speech] Rhubarb: ${path.basename(wavFile)}`);

  try {
    await execFileAsync(rhubarbBin, args);
    log.info(`[Speech] Rhubarb done`);
  } catch (err) {
    log.error(`[Speech] Rhubarb failed:`, (err as Error).message);
    throw err;
  }
}

interface RhubarbOutput {
  mouthCues: Array<{ value: string; start: number; end: number }>;
}

function parseVisemes(raw: string): VisemeEvent[] {
  const data = JSON.parse(raw) as RhubarbOutput;
  return data.mouthCues.map(cue => ({
    viseme: RHUBARB_TO_ARKIT[cue.value] ?? 'viseme_sil',
    start:  cue.start,
    end:    cue.end,
  }));
}

// ── Single-sentence processor ─────────────────────────────────────────────────

async function processSentence(
  sentence: string,
  id: number,
  totalChunks: number,
  agentName: string,
  sessionId: string,
  voiceUrl: string | null,
  modelPath: string | null,
  speakerId: number | null,
): Promise<SpeechChunk | null> {
  const tmpDir       = os.tmpdir();
  const wavFile      = path.join(tmpDir, `${sessionId}_${id}.wav`);
  const jsonFile     = path.join(tmpDir, `${sessionId}_${id}.json`);
  const dialogueFile = path.join(tmpDir, `${sessionId}_${id}.txt`);

  log.info(`[Speech] Sentence ${id + 1}/${totalChunks}: "${sentence.slice(0, 60)}"`);

  try {
    // Write dialogue hint to a temp file — Rhubarb -d expects a file path
    await writeFile(dialogueFile, sentence, 'utf-8');

    let wavBytes: Buffer;
    if (voiceUrl) {
      // Prefer HTTP server (model stays loaded between calls)
      wavBytes = await runPiperServer(sentence, voiceUrl, speakerId);
    } else {
      // Fall back to subprocess
      const model = modelPath ?? process.env['PIPER_MODEL']!;
      const sampleRate = await resolvedSampleRate(model);
      wavBytes = await runPiperProcess(sentence, model, sampleRate);
    }

    // Write WAV to disk for Rhubarb, then run Rhubarb
    await writeFile(wavFile, wavBytes);

    let visemes: VisemeEvent[] = [];
    try {
      await runRhubarb(wavFile, dialogueFile, jsonFile);
      const visemeRaw = await readFile(jsonFile, 'utf-8');
      visemes = parseVisemes(visemeRaw);
    } catch {
      // Rhubarb unavailable — audio still plays; browser uses synthetic oscillation
      log.warn(`[Speech] Rhubarb skipped for sentence ${id + 1} — no viseme data`);
    }

    const duration = visemes.length > 0 ? (visemes.at(-1)?.end ?? 0) : wavBytes.length / 2 / 22050;

    log.info(`[Speech] Sentence ${id + 1}/${totalChunks} ready — ${visemes.length} visemes, ${duration.toFixed(2)}s`);

    return {
      id,
      totalChunks,
      sentence,
      audioBase64: wavBytes.toString('base64'),
      visemes,
      duration,
      agentName,
    };
  } catch (err) {
    log.warn(`[Speech] Sentence ${id + 1} failed:`, (err as Error).message);
    return null;
  } finally {
    await Promise.all([
      unlink(wavFile).catch(() => {}),
      unlink(jsonFile).catch(() => {}),
      unlink(dialogueFile).catch(() => {}),
    ]);
  }
}

// ── Public pipeline ───────────────────────────────────────────────────────────

/** Returns false if TTS is not configured. */
export function isSpeechAvailable(): boolean {
  return !!process.env['PIPER_MODEL'];
}

/**
 * Process the full text through the TTS + viseme pipeline.
 * @param voiceUrl   URL of a running piper.http_server instance for this voice.
 *                   When null, falls back to subprocess using PIPER_MODEL.
 * Calls `onChunk` for each sentence as it completes (sequentially, in order).
 */
export async function processSpeech(
  text: string,
  agentName: string,
  voiceUrl: string | null,
  speakerId: number | null,
  onChunk: (chunk: SpeechChunk) => void,
): Promise<void> {
  if (!voiceUrl && !process.env['PIPER_MODEL']) return;

  const sentences = splitSentences(text);
  if (sentences.length === 0) {
    log.info(`[Speech] No speakable sentences in: "${text.slice(0, 80)}"`);
    return;
  }

  log.info(`[Speech] Starting pipeline for ${agentName} — ${sentences.length} sentence(s)`);
  const sessionId = `spk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  for (let i = 0; i < sentences.length; i++) {
    const chunk = await processSentence(sentences[i], i, sentences.length, agentName, sessionId, voiceUrl, null, speakerId);
    if (chunk) onChunk(chunk);
  }

  log.info(`[Speech] Pipeline complete for ${agentName}`);
}
