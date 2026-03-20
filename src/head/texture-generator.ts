import OpenAI from 'openai';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { FaceBounds } from './types.js';

export interface TextureGeneratorConfig {
  description: string;   // e.g. "middle aged indian man in dark blue shirt"
  outputPath: string;    // where to save the PNG
  apiKey?: string;
}

export async function generateHeadTexture(config: TextureGeneratorConfig): Promise<string> {
  const client = new OpenAI({ apiKey: config.apiKey ?? process.env['OPENAI_API_KEY'] });

  const prompt =
    `Photorealistic face texture for a 3D head model. ` +
    `${config.description}. ` +
    `Front-facing portrait, neutral expression, mouth closed, eyes open. ` +
    `Flat even studio lighting to minimise shadows — suitable for 3D texture mapping. ` +
    `Plain light grey background. No text, no watermarks. ` +
    `Face centred and filling most of the frame.`;

  const response = await client.images.generate({
    model: 'dall-e-3',
    prompt,
    n: 1,
    size: '1024x1024',
    response_format: 'url',
    quality: 'hd',
  });

  const url = response.data[0]?.url;
  if (!url) throw new Error('No URL returned from DALL-E');

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch texture: ${res.statusText}`);
  const buffer = Buffer.from(await res.arrayBuffer());

  await fs.mkdir(path.dirname(config.outputPath), { recursive: true });
  await fs.writeFile(config.outputPath, buffer);
  console.log(`Texture saved: ${config.outputPath}`);
  return config.outputPath;
}

/**
 * Use GPT-4o vision to detect the face bounding box in a portrait image.
 * Returns bounds as fractions [0,1] of the image dimensions.
 */
export async function detectFaceBounds(imagePath: string, apiKey?: string): Promise<FaceBounds> {
  const client = new OpenAI({ apiKey: apiKey ?? process.env['OPENAI_API_KEY'] });

  const imageData = await fs.readFile(imagePath);
  const base64 = imageData.toString('base64');
  const mimeType = 'image/png';

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: { url: `data:${mimeType};base64,${base64}` },
        },
        {
          type: 'text',
          text:
            'Analyse this face portrait. Return ONLY a JSON object with these four fields — ' +
            'all values are fractions of the image dimension (0.0 = top/left edge, 1.0 = bottom/right edge):\n' +
            '  "top":    y-fraction of the very top of the forehead\n' +
            '  "bottom": y-fraction of the bottom of the chin\n' +
            '  "left":   x-fraction of the widest point of the left cheek/ear\n' +
            '  "right":  x-fraction of the widest point of the right cheek/ear\n' +
            'No explanation, no markdown — just the raw JSON object.',
        },
      ],
    }],
    max_tokens: 100,
  });

  const text = response.choices[0]?.message.content ?? '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`GPT-4o did not return JSON: ${text}`);
  const bounds = JSON.parse(match[0]) as FaceBounds;
  console.log(`Face bounds detected: top=${bounds.top.toFixed(3)} bottom=${bounds.bottom.toFixed(3)} left=${bounds.left.toFixed(3)} right=${bounds.right.toFixed(3)}`);
  return bounds;
}
