// ── The API documents, for the docs page ─────────────────────────────────────
//
// /api-docs is one Swagger UI page for every HATS API, with a menu to switch
// between them. It reads them all from here, on the runner, so the page works
// wherever the dashboard does, even when the browser cannot reach the
// Project Server or the Agent Library directly.
//
// The services' own documents are fetched live, so they describe the version
// actually running; the copy shipped with the runner stands in when a service
// cannot be reached.

import type { IncomingMessage, ServerResponse } from 'http';
import { readOpenApiYaml, type OpenApiName } from '../../../packages/contracts/src/openapi.js';

const DOCUMENT = /^\/api\/openapi\/([^/]+)$/;
const FETCH_TIMEOUT_MS = 3000;

/** Each document's name in the URL, the contract it is, and where it lives. */
const DOCUMENTS: Record<string, { contract: OpenApiName; service?: 'projectServer' | 'agentLibrary' }> = {
  'runner.yaml':         { contract: 'runner' },
  'embodiment.yaml':     { contract: 'embodiment' },
  'project-server.yaml': { contract: 'projectServer', service: 'projectServer' },
  'agent-library.yaml':  { contract: 'agentLibrary', service: 'agentLibrary' },
};

export interface DocsRouterDeps {
  projectServerUrl: string | null;
  agentLibraryUrl: string | null;
  json: (res: ServerResponse, status: number, body: unknown) => void;
  fetch?: typeof fetch;
}

async function liveDocument(base: string | null, fetchFn: typeof fetch): Promise<string | null> {
  if (!base) return null;
  try {
    const res = await fetchFn(`${base.replace(/\/$/, '')}/api/v1/openapi.yaml`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

export async function handleDocsRoutes(
  d: DocsRouterDeps, pathname: string, method: string, _req: IncomingMessage, res: ServerResponse,
): Promise<boolean> {
  const match = method === 'GET' ? DOCUMENT.exec(pathname) : null;
  if (!match) return false;
  const doc = DOCUMENTS[decodeURIComponent(match[1]!)];
  if (!doc) { d.json(res, 404, { error: `No such document. Try one of: ${Object.keys(DOCUMENTS).join(', ')}` }); return true; }

  const base = doc.service === 'projectServer' ? d.projectServerUrl
    : doc.service === 'agentLibrary' ? d.agentLibraryUrl : null;
  const live = doc.service ? await liveDocument(base, d.fetch ?? fetch) : null;
  res.writeHead(200, {
    'Content-Type': 'application/yaml; charset=utf-8',
    'Cache-Control': 'no-cache',
    // Says whether the page is looking at the running service or the shipped copy.
    'X-Document-Source': live ? 'live' : 'bundled',
  });
  res.end(live ?? readOpenApiYaml(doc.contract));
  return true;
}
