/**
 * The published Piper voices, and fetching one into the voices folder.
 *
 * Piper's catalogue (voices.json) names every voice with its language,
 * quality, speakers and files, each with a size and an MD5. A download is
 * checked against that MD5 and only then moved into place, so a voice the
 * service finds on disk is always a whole one.
 */

import { createHash } from 'crypto';
import { createWriteStream, existsSync } from 'fs';
import { rename, rm } from 'fs/promises';
import * as path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

/** One voice as voices.json describes it. Only the fields used here. */
export interface PiperCatalogueEntry {
  key: string;
  name: string;
  language: { code: string; family: string; name_english: string; country_english: string };
  quality: string;
  num_speakers: number;
  files: Record<string, { size_bytes: number; md5_digest: string }>;
}

export type PiperCatalogue = Record<string, PiperCatalogueEntry>;

/** What the UI lists. */
export interface CatalogueVoice {
  name: string;
  language: string;
  languageCode: string;
  country: string;
  quality: string;
  speakers: number;
  sizeBytes: number;
  installed: boolean;
}

/** Voice names become file names, so nothing else is accepted. */
export const isVoiceName = (name: string): boolean => /^[A-Za-z0-9_-]{1,100}$/.test(name);

const modelFile = (entry: PiperCatalogueEntry, ext: '.onnx' | '.onnx.json') =>
  Object.keys(entry.files).find((f) => f.endsWith(`/${entry.key}${ext}`));

/** The catalogue, flattened and sorted, marking what is already installed. */
export function toCatalogueVoices(catalogue: PiperCatalogue, installed: Set<string>): CatalogueVoice[] {
  return Object.values(catalogue)
    .map((entry) => {
      const onnx = modelFile(entry, '.onnx');
      return {
        name: entry.key,
        language: entry.language.name_english,
        languageCode: entry.language.code,
        country: entry.language.country_english,
        quality: entry.quality,
        speakers: entry.num_speakers,
        sizeBytes: onnx ? entry.files[onnx]!.size_bytes : 0,
        installed: installed.has(entry.key),
      };
    })
    .sort((a, b) => a.languageCode.localeCompare(b.languageCode) || a.name.localeCompare(b.name));
}

export class VoiceCatalogue {
  private cached: { at: number; catalogue: PiperCatalogue } | null = null;

  /** `baseUrl` is the root voices.json and the model paths are relative to. */
  constructor(private readonly baseUrl: string, private readonly ttlMs = 60 * 60 * 1000) {}

  async get(): Promise<PiperCatalogue> {
    if (this.cached && Date.now() - this.cached.at < this.ttlMs) return this.cached.catalogue;
    const res = await fetch(`${this.baseUrl}/voices.json`, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`The Piper voice catalogue answered ${res.status}`);
    const catalogue = await res.json() as PiperCatalogue;
    this.cached = { at: Date.now(), catalogue };
    return catalogue;
  }

  /** Download a voice's model and config into `voicesDir`. Returns the model's file name. */
  async download(name: string, voicesDir: string): Promise<string> {
    const entry = (await this.get())[name];
    if (!entry) throw new UnknownVoiceError(name);

    const written: string[] = [];
    try {
      // The config first: a model without it cannot be loaded, but a stray
      // config is ignored, so this order never leaves a half voice behind.
      for (const ext of ['.onnx.json', '.onnx'] as const) {
        const remote = modelFile(entry, ext);
        if (!remote) throw new Error(`The catalogue lists no ${ext} file for ${name}`);
        const dest = path.join(voicesDir, `${name}${ext}`);
        await this.fetchVerified(`${this.baseUrl}/${remote}`, dest, entry.files[remote]!.md5_digest);
        written.push(dest);
      }
    } catch (err) {
      for (const file of written) await rm(file, { force: true });
      throw err;
    }
    return `${name}.onnx`;
  }

  private async fetchVerified(url: string, dest: string, md5: string): Promise<void> {
    const res = await fetch(url, { signal: AbortSignal.timeout(15 * 60_000) });
    if (!res.ok || !res.body) throw new Error(`Downloading ${path.basename(dest)} failed: HTTP ${res.status}`);

    const partial = `${dest}.part`;
    const hash = createHash('md5');
    try {
      await pipeline(
        Readable.fromWeb(res.body as import('stream/web').ReadableStream),
        async function* (source: AsyncIterable<Buffer>) {
          for await (const chunk of source) { hash.update(chunk); yield chunk; }
        },
        createWriteStream(partial),
      );
      const actual = hash.digest('hex');
      if (actual !== md5) throw new Error(`${path.basename(dest)} arrived damaged (MD5 ${actual}, expected ${md5})`);
      await rename(partial, dest);
    } finally {
      if (existsSync(partial)) await rm(partial, { force: true });
    }
  }
}

export class UnknownVoiceError extends Error {
  constructor(name: string) { super(`"${name}" is not in the Piper voice catalogue`); }
}
