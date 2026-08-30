import { IncomingMessage, ServerResponse } from 'http';
import { MCPCatalogueEntry, MCPCategory } from '../mcp/mcp-catalogue.js';
import { getCatalogue, addEntry, updateEntry, removeEntry } from '../mcp/catalogue-store.js';

const VALID_TRANSPORTS = ['stdio', 'sse', 'http'] as const;
const VALID_CATEGORIES: MCPCategory[] = ['productivity', 'files', 'web', 'data', 'dev'];

function validateEntry(body: Partial<MCPCatalogueEntry>): string | null {
  if (!body.id?.trim())   return 'id is required';
  if (!body.name?.trim()) return 'name is required';
  if (!body.category || !VALID_CATEGORIES.includes(body.category)) return `category must be one of: ${VALID_CATEGORIES.join(', ')}`;
  if (!body.config)       return 'config is required';
  if (!VALID_TRANSPORTS.includes((body.config as { transport: string }).transport as never)) return 'config.transport must be stdio, sse, or http';
  if (body.config.transport === 'stdio' && !body.config.command?.trim()) return 'config.command is required for stdio transport';
  return null;
}

export interface MCPCatalogueRouterDeps {
  json(res: ServerResponse, status: number, body: unknown): void;
  readBody(req: IncomingMessage): Promise<string>;
  sseBroadcast(data: object): void;
}

export class MCPCatalogueRouter {
  private deps: MCPCatalogueRouterDeps;

  constructor(deps: MCPCatalogueRouterDeps) {
    this.deps = deps;
  }

  async handleRoutes(pathname: string, method: string, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const { json, readBody, sseBroadcast } = this.deps;

    // POST /api/mcp/catalogue — add new entry
    if (pathname === '/api/mcp/catalogue' && method === 'POST') {
      const body = JSON.parse(await readBody(req)) as Partial<MCPCatalogueEntry>;
      const err = validateEntry(body);
      if (err) { json(res, 400, { error: err }); return true; }
      try {
        await addEntry(body as MCPCatalogueEntry);
        sseBroadcast({ type: 'catalogue_update', catalogue: getCatalogue() });
        json(res, 201, { ok: true });
      } catch (e) { json(res, 409, { error: (e as Error).message }); }
      return true;
    }

    // PATCH /api/mcp/catalogue/:id — update an entry
    if (pathname.match(/^\/api\/mcp\/catalogue\/[^/]+$/) && method === 'PATCH') {
      const id   = decodeURIComponent(pathname.slice('/api/mcp/catalogue/'.length));
      const body = JSON.parse(await readBody(req)) as Partial<MCPCatalogueEntry>;
      try {
        await updateEntry(id, body);
        sseBroadcast({ type: 'catalogue_update', catalogue: getCatalogue() });
        json(res, 200, { ok: true });
      } catch (e) { json(res, 404, { error: (e as Error).message }); }
      return true;
    }

    // DELETE /api/mcp/catalogue/:id — remove an entry
    if (pathname.match(/^\/api\/mcp\/catalogue\/[^/]+$/) && method === 'DELETE') {
      const id = decodeURIComponent(pathname.slice('/api/mcp/catalogue/'.length));
      try {
        await removeEntry(id);
        sseBroadcast({ type: 'catalogue_update', catalogue: getCatalogue() });
        json(res, 200, { ok: true });
      } catch (e) { json(res, 404, { error: (e as Error).message }); }
      return true;
    }

    return false;
  }
}
