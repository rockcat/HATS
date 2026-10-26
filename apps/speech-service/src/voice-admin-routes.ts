/**
 * Managing which voices are installed.
 *
 *   GET    /api/v1/voices/catalogue   every published Piper voice, marked if installed
 *   POST   /api/v1/voices/install     { name } — download, verify and start it
 *   DELETE /api/v1/voices/:name       stop it and delete its files
 *
 * The voices page at / is the front end for these.
 */

import { existsSync } from 'fs';
import { readdir } from 'fs/promises';
import * as path from 'path';
import { badRequest, del, fail, get, json, noContent, notFound, post, readJsonBody, type Route } from '@hats/service-kit/index';
import { isVoiceName, toCatalogueVoices, UnknownVoiceError, type VoiceCatalogue } from './voice-catalogue.js';
import type { VoiceManager } from './voice-manager.js';

const BASE = '/api/v1/voices';

/** Installed means the model is on disk, whether or not its server started. */
async function installedNames(voicesDir: string): Promise<Set<string>> {
  try {
    const files = await readdir(voicesDir);
    return new Set(files.filter((f) => f.endsWith('.onnx')).map((f) => f.replace(/\.onnx$/, '')));
  } catch {
    return new Set();
  }
}

export function voiceAdminRoutes(voices: VoiceManager, catalogue: VoiceCatalogue): Route[] {
  // Two clicks on Install must not download the same voice twice at once.
  const installing = new Map<string, Promise<unknown>>();

  const install = async (name: string) => {
    await voices.ensureDir();
    if (!existsSync(path.join(voices.voicesDir, `${name}.onnx`))) {
      await catalogue.download(name, voices.voicesDir);
    }
    return voices.add(name);
  };

  return [
    get(`${BASE}/catalogue`, async ({ res }) => {
      try {
        const all = await catalogue.get();
        json(res, 200, { voices: toCatalogueVoices(all, await installedNames(voices.voicesDir)) });
      } catch (err) {
        fail(res, 502, `Could not fetch the Piper voice catalogue: ${(err as Error).message}`, 'catalogue_unavailable');
      }
    }),

    post(`${BASE}/install`, async ({ req, res }) => {
      const name = (await readJsonBody<{ name?: string }>(req))?.name?.trim() ?? '';
      if (!isVoiceName(name)) { badRequest(res, 'name must be a Piper voice name, e.g. en_GB-alba-medium'); return; }

      let pending = installing.get(name);
      if (!pending) {
        pending = install(name).finally(() => installing.delete(name));
        installing.set(name, pending);
      }
      try {
        const voice = await pending as Awaited<ReturnType<typeof install>>;
        json(res, 201, { name: voice.name, speakerId: voice.speakerId, speakers: voice.speakers });
      } catch (err) {
        if (err instanceof UnknownVoiceError) { notFound(res, 'Voice'); return; }
        fail(res, 502, (err as Error).message, 'install_failed');
      }
    }),

    del(`${BASE}/:name`, async ({ res, params }) => {
      const name = params['name'] as string;
      if (!isVoiceName(name)) { badRequest(res, 'Not a voice name'); return; }
      const installed = await installedNames(voices.voicesDir);
      if (!installed.has(name) && !voices.getVoiceByName(name)) { notFound(res, 'Voice'); return; }
      await voices.remove(name);
      noContent(res);
    }),
  ];
}
