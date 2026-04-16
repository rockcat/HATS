#!/usr/bin/env node
// Downloads all en_GB medium Piper voices from HuggingFace.
// Called automatically by setup.sh / setup.bat, or run directly:
//   node scripts/download-voices.mjs

import { mkdir, writeFile, access } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT       = join(dirname(fileURLToPath(import.meta.url)), '..');
const VOICES_DIR = process.env.PIPER_VOICES_DIR ?? join(ROOT, 'piper_voices');

const HF_API     = 'https://huggingface.co/api/models/rhasspy/piper-voices/tree/main';
const HF_RESOLVE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main';

const green  = s => `  \x1b[32m✔\x1b[0m ${s}`;
const yellow = s => `  \x1b[33m!\x1b[0m ${s}`;

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function hfList(path) {
  const res = await fetch(`${HF_API}/${path}`);
  if (!res.ok) return [];
  return res.json();
}

async function download(hfPath, dest) {
  const res = await fetch(`${HF_RESOLVE}/${hfPath}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
}

await mkdir(VOICES_DIR, { recursive: true });

let downloaded = 0, skipped = 0, failed = 0;

const voices = (await hfList('en/en_GB')).filter(e => e.type === 'directory');

for (const voice of voices) {
  const files  = await hfList(`${voice.path}/medium`);
  const onnx   = files.filter(f => f.type === 'file' && f.path.endsWith('.onnx'));

  for (const file of onnx) {
    const filename = file.path.split('/').pop();
    const dest     = join(VOICES_DIR, filename);

    if (await fileExists(dest)) {
      skipped++;
      continue;
    }

    process.stdout.write(`    Downloading ${filename}...\n`);
    try {
      await download(file.path, dest);
      downloaded++;
    } catch (err) {
      process.stdout.write(yellow(`Failed: ${filename} — ${err.message}`) + '\n');
      failed++;
    }
  }
}

if (downloaded > 0) console.log(green(`Downloaded ${downloaded} new .onnx voice(s)`));
if (skipped    > 0) console.log(green(`${skipped} voice(s) already present — skipped`));
if (failed     > 0) console.log(yellow(`${failed} download(s) failed`));
if (downloaded === 0 && skipped === 0 && failed === 0) {
  console.log(yellow('No voices found'));
}
