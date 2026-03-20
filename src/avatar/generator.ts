import OpenAI, { toFile } from 'openai';
import * as fs from 'fs/promises';
import * as path from 'path';
import { AvatarConfig, AvatarAssets, EyeBounds, Rect, VisemeId } from './types.js';
import { VISEME_IDS, VISEME_DESCRIPTIONS } from './visemes.js';

export class AvatarGenerator {
  private client: OpenAI;

  constructor(apiKey?: string) {
    this.client = new OpenAI({ apiKey: apiKey ?? process.env['OPENAI_API_KEY'] });
  }

  async generate(config: AvatarConfig): Promise<AvatarAssets> {
    await fs.mkdir(config.outputDir, { recursive: true });
    const size = 1024; // DALL-E 3 always 1024x1024

    // Step 1: Generate base face with DALL-E 3
    console.log(`[1/4] Generating base face for "${config.name}"...`);
    const baseImagePath = await this.generateBaseFace(config, size);

    // Step 2: Ask GPT-4o to (a) describe the character precisely, (b) locate the eyes and mouth
    console.log('[2/4] Analysing face with GPT-4o...');
    const { characterDescription, eyeBounds, mouthBounds } = await this.analyseface(baseImagePath, size);
    console.log(`      Character: ${characterDescription.substring(0, 80)}...`);
    console.log(`      Left eye:  x=${eyeBounds.left.x} y=${eyeBounds.left.y} w=${eyeBounds.left.width} h=${eyeBounds.left.height}`);
    console.log(`      Right eye: x=${eyeBounds.right.x} y=${eyeBounds.right.y} w=${eyeBounds.right.width} h=${eyeBounds.right.height}`);
    console.log(`      Mouth:     x=${mouthBounds.x} y=${mouthBounds.y} w=${mouthBounds.width} h=${mouthBounds.height}`);

    // Step 3: Inpaint just the mouth region for each viseme using DALL-E 2 edit
    console.log(`[3/4] Generating ${VISEME_IDS.length} viseme frames (mouth inpainting)...`);
    const displaySize = config.imageSize ?? 512;
    const visemeFrames = {} as Record<VisemeId, string>;
    for (const visemeId of VISEME_IDS) {
      console.log(`      viseme: ${visemeId}`);
      visemeFrames[visemeId] = await this.generateVisemeFrame(
        config, visemeId, characterDescription, baseImagePath, mouthBounds, displaySize,
      );
    }

    // Scale bounds from 1024 → displaySize for runtime use
    const scale = displaySize / size;
    const scaledEyeBounds: EyeBounds = {
      left: scaleRect(eyeBounds.left, scale),
      right: scaleRect(eyeBounds.right, scale),
    };
    const scaledMouthBounds: Rect = scaleRect(mouthBounds, scale);

    const assets: AvatarAssets = {
      name: config.name,
      description: config.description,
      characterDescription,
      baseImagePath,
      visemeFrames,
      eyeBounds: scaledEyeBounds,
      mouthBounds: scaledMouthBounds,
    };

    const manifestPath = path.join(config.outputDir, `${config.name}-manifest.json`);
    await fs.writeFile(manifestPath, JSON.stringify(assets, null, 2), 'utf-8');
    console.log(`[4/4] Done. Manifest: ${manifestPath}`);
    return assets;
  }

  // ── Step 1 ────────────────────────────────────────────────────────────────

  private async generateBaseFace(config: AvatarConfig, size: number): Promise<string> {
    const prompt =
      `Photorealistic portrait of ${config.description}. ` +
      `Head and shoulders, neutral expression, mouth closed, eyes open, facing camera directly. ` +
      `Professional studio lighting, plain light grey background. ` +
      `Ultra high detail. No text, no watermarks.`;

    const response = await this.client.images.generate({
      model: 'dall-e-3',
      prompt,
      n: 1,
      size: `${size}x${size}` as '1024x1024',
      response_format: 'url',
      quality: 'hd',
    });

    const url = response.data[0]?.url;
    if (!url) throw new Error('No URL for base face');

    const buffer = await fetchBuffer(url);
    const filePath = path.join(config.outputDir, `${config.name}-base.png`);
    await fs.writeFile(filePath, buffer);
    return filePath;
  }

  // ── Step 2 ────────────────────────────────────────────────────────────────

  private async analyseface(
    imagePath: string,
    imageSize: number,
  ): Promise<{ characterDescription: string; eyeBounds: EyeBounds; mouthBounds: Rect }> {
    const base64 = (await fs.readFile(imagePath)).toString('base64');

    const response = await this.client.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${base64}`, detail: 'high' },
            },
            {
              type: 'text',
              text: `This is a ${imageSize}x${imageSize} portrait. Return ONLY a JSON object with no explanation or markdown:
{
  "characterDescription": "<one detailed sentence describing this specific person: age, ethnicity, hair colour/style, eye colour, skin tone, facial features, clothing visible>",
  "leftEye": {"x":<left edge px>,"y":<top edge px>,"width":<px>,"height":<px>},
  "rightEye": {"x":<left edge px>,"y":<top edge px>,"width":<px>,"height":<px>},
  "mouth": {"x":<left edge px>,"y":<top edge px>,"width":<px>,"height":<px>}
}
Include ~8px padding around each eye. For mouth include the full lips plus ~15px padding on all sides (wide enough to show all mouth shapes). Coordinates are pixel values for a ${imageSize}x${imageSize} image.`,
            },
          ],
        },
      ],
    });

    const text = response.choices[0]?.message.content ?? '';
    return parseFaceAnalysis(text, imageSize);
  }

  // ── Step 3 ────────────────────────────────────────────────────────────────

  private async generateVisemeFrame(
    config: AvatarConfig,
    visemeId: VisemeId,
    characterDescription: string,
    baseImagePath: string,
    mouthBounds1024: Rect,
    displaySize: number,
  ): Promise<string> {
    const { createCanvas, loadImage } = await import('@napi-rs/canvas');
    const mouthDesc = VISEME_DESCRIPTIONS[visemeId];

    // Build RGBA base image for DALL-E 2 edit endpoint
    const baseImg = await loadImage(await fs.readFile(baseImagePath));
    const imgCanvas = createCanvas(1024, 1024);
    imgCanvas.getContext('2d').drawImage(baseImg, 0, 0, 1024, 1024);
    const imageBuffer = imgCanvas.toBuffer('image/png');

    // Build mask: opaque everywhere, transparent at mouth region (= regenerate)
    const maskCanvas = createCanvas(1024, 1024);
    const maskCtx = maskCanvas.getContext('2d');
    maskCtx.fillStyle = 'black';
    maskCtx.fillRect(0, 0, 1024, 1024);
    const pad = 20;
    maskCtx.clearRect(
      mouthBounds1024.x - pad,
      mouthBounds1024.y - pad,
      mouthBounds1024.width + pad * 2,
      mouthBounds1024.height + pad * 2,
    );
    const maskBuffer = maskCanvas.toBuffer('image/png');

    const prompt =
      `Photorealistic portrait, same person: ${characterDescription}. ` +
      `${mouthDesc}. Same studio lighting, same background. Ultra high detail.`;

    const response = await this.client.images.edit({
      model: 'dall-e-2',
      image: await toFile(imageBuffer, 'face.png', { type: 'image/png' }),
      mask: await toFile(maskBuffer, 'mask.png', { type: 'image/png' }),
      prompt,
      n: 1,
      size: '1024x1024',
    });

    const url = response.data[0]?.url;
    if (!url) throw new Error(`No URL for viseme ${visemeId}`);

    const rawBuffer = await fetchBuffer(url);

    let finalBuffer: Buffer;
    if (displaySize < 1024) {
      const canvas = createCanvas(displaySize, displaySize);
      const ctx = canvas.getContext('2d');
      const img = await loadImage(rawBuffer);
      ctx.drawImage(img, 0, 0, displaySize, displaySize);
      finalBuffer = canvas.toBuffer('image/png');
    } else {
      finalBuffer = rawBuffer;
    }

    const filePath = path.join(config.outputDir, `${config.name}-${visemeId}.png`);
    await fs.writeFile(filePath, finalBuffer);
    return filePath;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

interface RawFaceAnalysis {
  characterDescription?: string;
  leftEye?: Rect;
  rightEye?: Rect;
  mouth?: Rect;
}

function parseFaceAnalysis(
  text: string,
  imageSize: number,
): { characterDescription: string; eyeBounds: EyeBounds; mouthBounds: Rect } {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const fallbackRect = (xFrac: number, yFrac: number, wFrac: number, hFrac: number): Rect => ({
    x: Math.round(imageSize * xFrac),
    y: Math.round(imageSize * yFrac),
    width: Math.round(imageSize * wFrac),
    height: Math.round(imageSize * hFrac),
  });

  const fallbacks = {
    characterDescription: 'a person with neutral expression',
    eyeBounds: {
      left: fallbackRect(0.28, 0.35, 0.12, 0.06),
      right: fallbackRect(0.58, 0.35, 0.12, 0.06),
    },
    mouthBounds: fallbackRect(0.32, 0.60, 0.36, 0.15),
  };

  if (!jsonMatch) return fallbacks;

  try {
    const parsed = JSON.parse(jsonMatch[0]) as RawFaceAnalysis;
    return {
      characterDescription: parsed.characterDescription ?? fallbacks.characterDescription,
      eyeBounds: {
        left: parsed.leftEye ?? fallbacks.eyeBounds.left,
        right: parsed.rightEye ?? fallbacks.eyeBounds.right,
      },
      mouthBounds: parsed.mouth ?? fallbacks.mouthBounds,
    };
  } catch {
    return fallbacks;
  }
}

function scaleRect(r: Rect, scale: number): Rect {
  return {
    x: Math.round(r.x * scale),
    y: Math.round(r.y * scale),
    width: Math.round(r.width * scale),
    height: Math.round(r.height * scale),
  };
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Image fetch failed: ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}
