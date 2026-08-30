/**
 * A reverse proxy route for the UI-only apps.
 *
 * The front-ends talk to one origin — their own — and this forwards to the
 * Agent Library, Project Server or Team Runner. That keeps CORS, cookies and
 * mixed-content out of the browser's way, and means an operator only has to
 * expose the UI port.
 */

import { Readable } from 'stream';
import { fail } from './http.js';
import { route, type Route } from './router.js';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'host']);

export interface ProxyOptions {
  /** Local path prefix, e.g. `/proxy/library`. */
  prefix: string;
  /** Upstream origin, e.g. `http://localhost:3010`. */
  target: string;
  label: string;
  timeoutMs?: number;
  /**
   * Headers added to every forwarded request — typically credentials for an
   * authenticated upstream. Set here rather than in the browser so the secret
   * stays on the server.
   */
  headers?: Record<string, string>;
}

export function proxyRoutes(options: ProxyOptions): Route[] {
  const { prefix, target, label } = options;
  const timeoutMs = options.timeoutMs ?? 30_000;

  return METHODS.map((method) => route(method, `${prefix}/*rest`, async ({ req, res, url, params }) => {
    const upstream = `${target.replace(/\/$/, '')}/${params['rest'] ?? ''}${url.search}`;

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (HOP_BY_HOP.has(key.toLowerCase()) || value === undefined) continue;
      headers[key] = Array.isArray(value) ? value.join(', ') : value;
    }
    Object.assign(headers, options.headers ?? {});

    const init: RequestInit = { method, headers, signal: AbortSignal.timeout(timeoutMs) };
    if (method !== 'GET' && method !== 'DELETE') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
      if (chunks.length) init.body = Buffer.concat(chunks);
    }

    let response: Response;
    try {
      response = await fetch(upstream, init);
    } catch (err) {
      fail(res, 502, `${label} is unreachable: ${(err as Error).message}`, 'upstream_unreachable');
      return;
    }

    const contentType = response.headers.get('content-type') ?? 'application/octet-stream';

    // Event streams must be piped through — buffering one would hang the client
    // until the stream ended, which for SSE is never.
    if (contentType.includes('text/event-stream') && response.body) {
      res.writeHead(response.status, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      const stream = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
      req.on('close', () => stream.destroy());
      stream.on('error', () => res.end());
      stream.pipe(res);
      return;
    }

    const body = Buffer.from(await response.arrayBuffer());
    res.writeHead(response.status, {
      'Content-Type': contentType,
      'Content-Length': String(body.length),
    });
    res.end(body);
  }));
}
