/**
 * Speech synthesis pipeline: text → Piper TTS → Rhubarb visemes → SpeechChunk
 *
 * Environment variables:
 *   PIPER_MODEL       Path to the .onnx voice model (required to enable TTS).
 *   PIPER_BIN         piper executable (default: "piper").
 *   RHUBARB_BIN       rhubarb executable (default: "rhubarb").
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
    .replace(/[|\\]/g, ' ');                   // table pipes, backslashes
}

/** Split text into speakable sentences. */
export function splitSentences(text: string): string[] {
  const plain = stripMarkdown(text);
  return plain
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map(s => s.trim().replace(/\s+/g, ' '))
    .filter(s => s.length > 3 && /[a-zA-Z]/.test(s));
}

// ── Piper TTS ─────────────────────────────────────────────────────────────────

async function runPiper(text: string, outFile: string): Promise<void> {
  const model    = process.env['PIPER_MODEL']!;
  const piperBin = process.env['PIPER_BIN'] ?? 'piper';

  console.log(`[Speech] Piper: "${text.slice(0, 60)}" → ${path.basename(outFile)}`);

  return new Promise((resolve, reject) => {
    const child = spawn(piperBin, ['--model', model, '--output_file', outFile], {
      stdio: ['pipe', 'ignore', 'pipe'],
    });

    let stderr = '';
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

    child.stdin.write(text, 'utf-8');
    child.stdin.end();

    child.on('exit', (code) => {
      if (code === 0) {
        console.log(`[Speech] Piper done (exit 0)`);
        resolve();
      } else {
        console.error(`[Speech] Piper failed (exit ${code}):\n${stderr}`);
        reject(new Error(`piper exited ${code}: ${stderr.slice(0, 400)}`));
      }
    });
    child.on('error', (err) => {
      console.error(`[Speech] Piper spawn error:`, err.message);
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
    '-d', dialogueFile,   // file path, not inline text
    '-o', jsonFile,
    wavFile,
    '--quiet',
  ];

  console.log(`[Speech] Rhubarb: ${rhubarbBin} ${args.join(' ')}`);

  try {
    await execFileAsync(rhubarbBin, args);
    console.log(`[Speech] Rhubarb done`);
  } catch (err) {
    console.error(`[Speech] Rhubarb failed:`, (err as Error).message);
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
): Promise<SpeechChunk | null> {
  const tmpDir       = os.tmpdir();
  const wavFile      = path.join(tmpDir, `${sessionId}_${id}.wav`);
  const jsonFile     = path.join(tmpDir, `${sessionId}_${id}.json`);
  const dialogueFile = path.join(tmpDir, `${sessionId}_${id}.txt`);

  console.log(`[Speech] Processing sentence ${id + 1}/${totalChunks}: "${sentence.slice(0, 60)}"`);

  try {
    // Write dialogue hint to a temp file — Rhubarb -d expects a file path
    await writeFile(dialogueFile, sentence, 'utf-8');

    await runPiper(sentence, wavFile);
    await runRhubarb(wavFile, dialogueFile, jsonFile);

    const [audioBytes, visemeRaw] = await Promise.all([
      readFile(wavFile),
      readFile(jsonFile, 'utf-8'),
    ]);

    const visemes  = parseVisemes(visemeRaw);
    const duration = visemes.at(-1)?.end ?? 0;

    console.log(`[Speech] Sentence ${id + 1}/${totalChunks} ready — ${visemes.length} visemes, ${duration.toFixed(2)}s`);

    return {
      id,
      totalChunks,
      sentence,
      audioBase64: audioBytes.toString('base64'),
      visemes,
      duration,
      agentName,
    };
  } catch (err) {
    console.warn(`[Speech] Sentence ${id} failed:`, (err as Error).message);
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

/** Returns false if TTS is not configured (PIPER_MODEL env var not set). */
export function isSpeechAvailable(): boolean {
  return !!process.env['PIPER_MODEL'];
}

/**
 * Process the full text through the TTS + viseme pipeline.
 * Calls `onChunk` for each sentence as it completes.
 * Sentences are processed sequentially so chunks arrive in order.
 */
export async function processSpeech(
  text: string,
  agentName: string,
  onChunk: (chunk: SpeechChunk) => void,
): Promise<void> {
  if (!isSpeechAvailable()) return;

  const sentences = splitSentences(text);
  if (sentences.length === 0) {
    console.log(`[Speech] No speakable sentences found in: "${text.slice(0, 80)}"`);
    return;
  }

  console.log(`[Speech] Starting pipeline for ${agentName} — ${sentences.length} sentence(s)`);
  const sessionId = `spk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  for (let i = 0; i < sentences.length; i++) {
    const chunk = await processSentence(sentences[i], i, sentences.length, agentName, sessionId);
    if (chunk) onChunk(chunk);
  }

  console.log(`[Speech] Pipeline complete for ${agentName}`);
}
