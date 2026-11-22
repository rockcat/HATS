import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { forwardAsset, upstreamFor } from './static-assets.js';

let servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  servers = [];
});

/** Start a server on a free port and return its origin. */
async function serve(handler: Parameters<typeof createServer>[0]): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** A runner route that forwards everything to `library`. */
const runnerFor = (library: string | null) => serve((req, res) => {
  const url = upstreamFor(req.url ?? '/', library);
  if (!url) { res.writeHead(404); res.end(); return; }
  void forwardAsset(url, res, { 'Cache-Control': 'public, max-age=86400' });
});

describe('assets the runner fetches from the library', () => {
  it('passes the file through with its type', async () => {
    const library = await serve((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      res.end(`// ${req.url}`);
    });
    const r = await fetch(`${await runnerFor(library)}/nm/three/build/three.module.js`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('text/javascript');
    expect(r.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(await r.text()).toBe('// /nm/three/build/three.module.js');
  });

  it('says not found when the library has no such file', async () => {
    const library = await serve((_req, res) => { res.writeHead(404); res.end(); });
    expect((await fetch(`${await runnerFor(library)}/avatars/nobody.glb`)).status).toBe(404);
  });

  it('says the service is down rather than hanging when the library is gone', async () => {
    const r = await fetch(`${await runnerFor('http://127.0.0.1:9')}/avatars/a.glb`);
    expect(r.status).toBe(502);
  });

  it('has nowhere to look without a library', () => {
    expect(upstreamFor('/nm/three/x.js', null)).toBeNull();
    expect(upstreamFor('/nm/x.js', 'http://library:3010/')).toBe('http://library:3010/nm/x.js');
  });
});
