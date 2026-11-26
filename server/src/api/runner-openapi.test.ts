import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { ServerResponse } from 'http';
import { readOpenApiJson } from '../../../packages/contracts/src/openapi.js';
import { routesInLine, routesInSources, regexToPaths, normalisePath } from './route-inventory.js';
import { handleDocsRoutes } from './docs-router.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..', '..');

/** Every file that serves runner routes. The Embodiment API has its own spec. */
function routerSources(): string[] {
  const api = readdirSync(HERE)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'route-inventory.ts')
    .map((f) => path.join(HERE, f));
  const auth = ['auth-router.ts', 'user-management-router.ts'].map((f) => path.join(ROOT, 'packages', 'auth', 'src', f));
  return [...api, ...auth].map((f) => readFileSync(f, 'utf-8'));
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

function specOperations(): Map<string, Set<string>> {
  const doc = readOpenApiJson('runner') as { paths: Record<string, Record<string, unknown>> };
  const out = new Map<string, Set<string>>();
  for (const [p, item] of Object.entries(doc.paths)) {
    out.set(normalisePath(p), new Set(Object.keys(item).filter((k) => METHODS.includes(k)).map((m) => m.toUpperCase())));
  }
  return out;
}

describe('the runner OpenAPI document matches the code', () => {
  const code = routesInSources(routerSources());
  const spec = specOperations();

  it('finds the routes at all', () => {
    expect(code.size).toBeGreaterThan(100);
  });

  it('documents every route the code serves', () => {
    const missing = [...code.keys()].filter((p) => !spec.has(p));
    expect(missing, 'routes in server/src/api with no entry in packages/contracts/openapi/runner.openapi.yaml').toEqual([]);
  });

  it('documents every method the code names', () => {
    const missing = [...code].flatMap(([p, methods]) =>
      [...methods].filter((m) => spec.has(p) && !spec.get(p)!.has(m)).map((m) => `${m} ${p}`));
    expect(missing, 'methods the code serves that runner.openapi.yaml leaves out').toEqual([]);
  });

  it('documents nothing the code does not serve', () => {
    const stale = [...spec.keys()].filter((p) => !code.has(p));
    expect(stale, 'paths in runner.openapi.yaml that no router serves').toEqual([]);
  });
});

describe('reading routes from source', () => {
  it('reads each way a route is written', () => {
    expect(routesInLine(`if (pathname === '/api/kanban/tickets' && method === 'POST') {`))
      .toEqual([{ path: '/api/kanban/tickets', methods: ['POST'] }]);
    expect(routesInLine(String.raw`if (pathname.match(/^\/api\/agents\/[^/]+\/hat$/) && method === 'PATCH') {`))
      .toEqual([{ path: '/api/agents/{}/hat', methods: ['PATCH'] }]);
    expect(routesInLine(`if (pathname.startsWith('/api/meetings/') && pathname.endsWith('/cancel') && method === 'POST') {`))
      .toEqual([{ path: '/api/meetings/{}/cancel', methods: ['POST'] }]);
    expect(routesInLine(`if (pathname.startsWith('/api/agenda/') && method === 'DELETE') {`))
      .toEqual([{ path: '/api/agenda/{}', methods: ['DELETE'] }]);
    expect(routesInLine(String.raw`const STEP = /^\/api\/visits\/([^/]+)\/(approve|refuse)$/;`).map((r) => r.path))
      .toEqual(['/api/visits/{}/approve', '/api/visits/{}/refuse']);
  });

  it('ignores negations and the /api/ catch-all', () => {
    expect(routesInLine(`if (!pathname.startsWith('/api/auth/')) return false;`)).toEqual([]);
    expect(routesInLine(`if (pathname.startsWith('/api/')) { this.json(res, 404, {}); return; }`)).toEqual([]);
  });

  it('turns a route regex into paths', () => {
    expect(regexToPaths(String.raw`\/api\/x\/([^/]+)\/(a|b-c)`)).toEqual(['/api/x/{}/a', '/api/x/{}/b-c']);
    expect(normalisePath('/api/users/{id}/api-keys/{keyId}')).toBe('/api/users/{}/api-keys/{}');
  });
});

describe('the docs route', () => {
  function capture() {
    const out: { status?: number; headers?: Record<string, string>; body?: string; json?: unknown } = {};
    const res = {
      writeHead: (s: number, h: Record<string, string>) => { out.status = s; out.headers = h; },
      end: (b: string) => { out.body = b; },
    } as unknown as ServerResponse;
    const json = (_r: ServerResponse, s: number, b: unknown) => { out.status = s; out.json = b; };
    return { out, res, json };
  }
  const req = {} as never;

  it('serves the runner document', async () => {
    const { out, res, json } = capture();
    expect(await handleDocsRoutes({ projectServerUrl: null, agentLibraryUrl: null, json }, '/api/openapi/runner.yaml', 'GET', req, res)).toBe(true);
    expect(out.status).toBe(200);
    expect(out.body).toContain('HATS Team Runner API');
  });

  it("asks a service for its own document, and falls back to the shipped copy", async () => {
    const live = capture();
    const fetchLive = (async () => new Response('openapi: 3.1.0 # live')) as typeof fetch;
    await handleDocsRoutes({ projectServerUrl: 'http://ps:3020', agentLibraryUrl: null, json: live.json, fetch: fetchLive }, '/api/openapi/project-server.yaml', 'GET', req, live.res);
    expect(live.out.body).toBe('openapi: 3.1.0 # live');
    expect(live.out.headers?.['X-Document-Source']).toBe('live');

    const down = capture();
    const fetchDown = (async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch;
    await handleDocsRoutes({ projectServerUrl: 'http://ps:3020', agentLibraryUrl: null, json: down.json, fetch: fetchDown }, '/api/openapi/project-server.yaml', 'GET', req, down.res);
    expect(down.out.body).toContain('HATS Project Server API');
    expect(down.out.headers?.['X-Document-Source']).toBe('bundled');
  });

  it('says which documents exist when asked for another', async () => {
    const { out, res, json } = capture();
    await handleDocsRoutes({ projectServerUrl: null, agentLibraryUrl: null, json }, '/api/openapi/nope.yaml', 'GET', req, res);
    expect(out.status).toBe(404);
  });

  it('leaves other routes alone', async () => {
    const { res, json } = capture();
    expect(await handleDocsRoutes({ projectServerUrl: null, agentLibraryUrl: null, json }, '/api/project', 'GET', req, res)).toBe(false);
  });
});
