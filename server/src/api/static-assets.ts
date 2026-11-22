// ── Assets a runner may not hold itself ──────────────────────────────────────
//
// The dashboard loads three.js from /nm/, and avatars and backgrounds from
// /avatars/ and /backgrounds/. A runner started from source has them all
// locally. A runner image does not: three is a development dependency here,
// and the avatars ship with the services. Those come from the Agent Template
// Library, which serves the same three paths, so several runners share one
// copy instead of each carrying its own.

import type { ServerResponse } from 'http';
import { Readable } from 'stream';

/** Where to fetch `pathname` from when it is not on disk, or null for nowhere. */
export function upstreamFor(pathname: string, libraryUrl: string | null): string | null {
  return libraryUrl ? `${libraryUrl.replace(/\/$/, '')}${pathname}` : null;
}

/** Answer with the upstream's copy, streamed rather than held in memory. */
export async function forwardAsset(
  url: string, res: ServerResponse, extra: Record<string, string> = {},
): Promise<void> {
  try {
    const upstream = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!upstream.ok || !upstream.body) {
      res.writeHead(upstream.status === 404 ? 404 : 502);
      res.end(upstream.status === 404 ? 'Not found' : 'The asset service failed');
      return;
    }
    res.writeHead(200, {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      ...extra,
    });
    Readable.fromWeb(upstream.body as import('stream/web').ReadableStream).pipe(res);
  } catch {
    res.writeHead(502);
    res.end('The asset service is not answering');
  }
}
