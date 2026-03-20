/**
 * One-time setup for 3D head rendering.
 * Downloads facecap.glb from Three.js CDN and generates a DALL-E face texture.
 *
 * Usage:
 *   node --env-file=.env --import tsx/esm setup-3d.ts
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { generateHeadTexture, detectFaceBounds } from './src/head/texture-generator.js';

const ASSETS_DIR = path.join(process.cwd(), 'assets-3d');
// r150 tag — predates KTX2 textures in this file; compatible with headless-gl (WebGL 1)
const MODEL_URL = 'https://raw.githubusercontent.com/mrdoob/three.js/r150/examples/models/gltf/facecap.glb';
const MODEL_PATH = path.join(ASSETS_DIR, 'facecap.glb');
const TEXTURE_PATH = path.join(ASSETS_DIR, 'face-texture.png');
const MANIFEST_PATH = path.join(ASSETS_DIR, 'manifest.json');

const FACE_DESCRIPTION = 'middle aged indian man in a dark blue shirt, friendly expression';

async function main() {
  await fs.mkdir(ASSETS_DIR, { recursive: true });

  // Download head model
  if (await fileExists(MODEL_PATH)) {
    console.log(`Model already exists: ${MODEL_PATH}`);
  } else {
    console.log(`Downloading facecap.glb from Three.js CDN...`);
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`Failed to download model: ${res.statusText}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(MODEL_PATH, buffer);
    console.log(`Model saved: ${MODEL_PATH} (${(buffer.length / 1024).toFixed(0)} KB)`);
  }

  // Generate DALL-E texture
  if (await fileExists(TEXTURE_PATH)) {
    console.log(`Texture already exists: ${TEXTURE_PATH}`);
  } else {
    console.log(`Generating face texture with DALL-E 3...`);
    await generateHeadTexture({
      description: FACE_DESCRIPTION,
      outputPath: TEXTURE_PATH,
    });
  }

  // Detect face bounds in the texture
  console.log('Detecting face bounds with GPT-4o...');
  const faceBounds = await detectFaceBounds(TEXTURE_PATH);

  // Save manifest
  const manifest = {
    modelPath: MODEL_PATH,
    texturePath: TEXTURE_PATH,
    description: FACE_DESCRIPTION,
    faceBounds,
    createdAt: new Date().toISOString(),
  };
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`\nSetup complete. Manifest: ${MANIFEST_PATH}`);
  console.log(`\nNext: node --env-file=.env --import tsx/esm 3d-realtime-test.ts`);
}

async function fileExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

main().catch((err) => { console.error(err); process.exit(1); });
