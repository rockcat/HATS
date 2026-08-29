/** Static file serving for the service UIs. */

import { readFile } from 'fs/promises';
import * as path from 'path';
import type { ServerResponse } from 'http';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.glb':  'model/gltf-binary',
  '.woff2': 'font/woff2',
};

export function mimeFor(filePath: string): string {
  return MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Serve `pathname` from `rootDir`, falling back to index.html.
 * Returns false when the file does not exist so the caller can 404 its own way.
 */
export async function serveStatic(rootDir: string, pathname: string, res: ServerResponse): Promise<boolean> {
  const relative = pathname === '/' || pathname === '' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = path.resolve(rootDir, relative);
  if (target !== rootDir && !target.startsWith(rootDir + path.sep)) {
    res.writeHead(403); res.end('Forbidden');
    return true;
  }
  try {
    const data = await readFile(target);
    res.writeHead(200, { 'Content-Type': mimeFor(target), 'Cache-Control': 'no-cache' });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}
