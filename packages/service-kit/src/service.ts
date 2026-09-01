/**
 * The common shell every standalone HATS service runs inside:
 * CORS, routing, static UI, uniform errors, graceful shutdown.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { fail, sendError, setCors } from './http.js';
import { matchRoute, MethodNotAllowed, type RequestContext, type Route } from './router.js';
import { serveStatic } from './static-files.js';

export interface ServiceOptions {
  name: string;
  port: number;
  routes: Route[];
  /** Directory of static files served for any unmatched GET. */
  publicDir?: string;
  /** Extra static roots, e.g. the shared UI kit at `/ui-kit`. */
  mounts?: Array<{ prefix: string; dir: string }>;
  /** Extra lines printed under the startup banner. */
  banner?: string[];
  onShutdown?: () => Promise<void> | void;
}

export interface RunningService {
  server: Server;
  port: number;
  stop(): Promise<void>;
}

/** A path whose last segment carries a file extension is asking for a file. */
function looksLikeAsset(pathname: string): boolean {
  const last = pathname.split('/').pop() ?? '';
  return /\.[a-z0-9]{1,8}$/i.test(last);
}

export async function startService(options: ServiceOptions): Promise<RunningService> {
  const { name, port, routes, publicDir } = options;

  const server = createServer((req, res) => { void handle(req, res); });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    setCors(res);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    try {
      const match = matchRoute(routes, req.method ?? 'GET', url.pathname);
      if (match) {
        const ctx: RequestContext = { req, res, url, params: match.params, query: url.searchParams };
        await match.route.handler(ctx);
        return;
      }
      if (req.method === 'GET' || req.method === 'HEAD') {
        for (const mount of options.mounts ?? []) {
          if (!url.pathname.startsWith(mount.prefix)) continue;
          if (await serveStatic(mount.dir, url.pathname.slice(mount.prefix.length), res)) return;
        }
      }
      if (publicDir && (req.method === 'GET' || req.method === 'HEAD')) {
        if (await serveStatic(publicDir, url.pathname, res)) return;
        // Single-page fallback so deep links still load the UI — but only for
        // navigation. Returning index.html for a missing .js or .css leaves the
        // browser reporting a MIME error instead of the 404 that explains it.
        if (!url.pathname.startsWith('/api/') && !looksLikeAsset(url.pathname)
            && await serveStatic(publicDir, '/index.html', res)) return;
      }
      fail(res, 404, `No route for ${req.method} ${url.pathname}`, 'not_found');
    } catch (err) {
      if (err instanceof MethodNotAllowed) { fail(res, 405, err.message, 'method_not_allowed'); return; }
      sendError(res, err);
    }
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => { server.off('error', reject); resolve(); });
  });

  console.log(`[${name}] listening on http://localhost:${port}`);
  for (const line of options.banner ?? []) console.log(`[${name}] ${line}`);

  const stop = async (): Promise<void> => {
    await options.onShutdown?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    console.log(`[${name}] stopped`);
  };

  const onSignal = () => { void stop().then(() => process.exit(0)); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  return { server, port, stop };
}
