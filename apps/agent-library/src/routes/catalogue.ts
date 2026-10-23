/** Read-only reference data used when authoring a template. */

import { readFile, readdir } from 'fs/promises';
import * as path from 'path';
import {
  badRequest, binary, fail, get, json, post, readJsonBody, type Route,
} from '../../../../packages/service-kit/src/index.js';
import { SpeechClient } from '../../../../packages/clients/src/speech-client.js';
import { hatDefinitions } from '../../../../packages/core/src/hats/definitions.js';
import { personasByHat } from '../../../../packages/core/src/hats/personas.js';
import { SPECIALISATION_DIRECTIVES } from '../../../../packages/core/src/prompt/generator.js';
import { KNOWN_PROVIDERS } from '../../../../packages/core/src/providers.js';
import { listVoices } from '../../../../packages/speech-core/src/voice-models.js';

const BASE = '/api/v1';

/** Entries carry the camera framing the preview needs, so it is passed through whole. */
interface AvatarCatalogue {
  avatars?: Array<{
    file: string; name?: string; sex?: string;
    camera?: number[]; rotate?: number[]; fov?: number; scale?: number;
  }>;
}

export function catalogueRoutes(
  avatarsDir: string,
  backgroundsDir: string,
  voicesDir: string,
  speechServiceUrl: string,
): Route[] {
  const speech = new SpeechClient(speechServiceUrl);

  return [
    get(`${BASE}/personas`, ({ res }) => json(res, 200, personasByHat)),

    get(`${BASE}/hats`, ({ res }) => json(res, 200, { hats: Object.values(hatDefinitions) })),

    get(`${BASE}/specialisations`, ({ res }) =>
      json(res, 200, { specialisations: Object.keys(SPECIALISATION_DIRECTIVES).sort() })),

    get(`${BASE}/providers`, ({ res }) => json(res, 200, {
      providers: KNOWN_PROVIDERS.map((p) => ({
        name: p.id,
        label: p.label,
        models: p.models,
        configured: Boolean(process.env[p.envKey]),
      })),
    })),

    get(`${BASE}/avatars`, async ({ res }) => {
      try {
        const raw = await readFile(path.join(avatarsDir, 'avatars.json'), 'utf-8');
        const parsed = JSON.parse(raw) as AvatarCatalogue;
        json(res, 200, { avatars: parsed.avatars ?? [] });
      } catch {
        json(res, 200, { avatars: [] });
      }
    }),

    get(`${BASE}/voices`, async ({ res }) => {
      json(res, 200, { voices: await listVoices(voicesDir) });
    }),

    // Hearing a voice needs synthesis, which belongs to the Speech Service.
    // Listing them does not, which is why the dropdowns work without it.
    post(`${BASE}/voices/preview`, async ({ req, res }) => {
      const body = await readJsonBody<{ voice?: string; speakerName?: string }>(req);
      if (!body?.voice) { badRequest(res, 'voice is required'); return; }
      const wav = await speech.preview(body.voice, body.speakerName);
      if (!wav) {
        fail(res, 503, `No Speech Service at ${speechServiceUrl} — start it to hear a voice`, 'speech_unavailable');
        return;
      }
      binary(res, 200, wav, 'audio/wav');
    }),

    get(`${BASE}/backgrounds`, async ({ res }) => {
      try {
        const files = await readdir(backgroundsDir);
        json(res, 200, { backgrounds: files.filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort() });
      } catch {
        json(res, 200, { backgrounds: [] });
      }
    }),
  ];
}
