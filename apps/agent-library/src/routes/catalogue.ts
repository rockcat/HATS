/** Read-only reference data used when authoring a template. */

import { readFile, readdir } from 'fs/promises';
import * as path from 'path';
import { get, json, type Route } from '../../../../packages/service-kit/src/index.js';
import { hatDefinitions } from '../../../../server/src/hats/definitions.js';
import { personasByHat } from '../../../../server/src/hats/personas.js';
import { SPECIALISATION_DIRECTIVES } from '../../../../server/src/prompt/generator.js';
import { KNOWN_PROVIDERS } from '../../../../server/src/api/providers.js';
import { listVoices } from '../voices.js';

const BASE = '/api/v1';

/** Entries carry the camera framing the preview needs, so it is passed through whole. */
interface AvatarCatalogue {
  avatars?: Array<{
    file: string; name?: string; sex?: string;
    camera?: number[]; rotate?: number[]; fov?: number; scale?: number;
  }>;
}

export function catalogueRoutes(avatarsDir: string, backgroundsDir: string, voicesDir: string): Route[] {
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
