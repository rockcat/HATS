import { IncomingMessage, ServerResponse } from 'http';
import { EmailAllowlistStore, EmailAllowlistEntry } from './email-allowlist-store.js';

export interface EmailAllowlistRouterDeps {
  store: EmailAllowlistStore;
  sseBroadcast(data: object): void;
  json(res: ServerResponse, status: number, body: unknown): void;
  readBody(req: IncomingMessage): Promise<string>;
}

export class EmailAllowlistRouter {
  private deps: EmailAllowlistRouterDeps;

  constructor(deps: EmailAllowlistRouterDeps) {
    this.deps = deps;
  }

  async handleRoutes(pathname: string, method: string, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const { json, readBody, sseBroadcast } = this.deps;

    if (pathname === '/api/email-allowlist' && method === 'GET') {
      json(res, 200, this.deps.store.list());
      return true;
    }

    if (pathname === '/api/email-allowlist' && method === 'POST') {
      const body   = await readBody(req);
      const fields = JSON.parse(body) as { email?: string; reason?: string };
      const email  = fields.email?.trim().toLowerCase();
      if (!email) { json(res, 400, { error: 'email is required' }); return true; }
      const existing = this.deps.store.get(email);
      if (existing) { json(res, 409, { error: 'Email already in allowlist', entry: existing }); return true; }
      const now: string = new Date().toISOString();
      const entry: EmailAllowlistEntry = {
        email,
        status:      'approved',
        requestedBy: 'human',
        reason:      fields.reason,
        requestedAt: now,
        approvedAt:  now,
      };
      await this.deps.store.add(entry);
      sseBroadcast({ type: 'email_allowlist_update', allowlist: this.deps.store.list() });
      json(res, 201, entry);
      return true;
    }

    if (pathname.startsWith('/api/email-allowlist/') && method === 'PATCH') {
      const email  = decodeURIComponent(pathname.replace('/api/email-allowlist/', ''));
      const body   = await readBody(req);
      const fields = JSON.parse(body) as { action?: string };
      let entry: EmailAllowlistEntry | undefined;
      if (fields.action === 'approve')      entry = await this.deps.store.approve(email);
      else if (fields.action === 'reject')  entry = await this.deps.store.reject(email);
      else { json(res, 400, { error: 'action must be "approve" or "reject"' }); return true; }
      if (!entry) { json(res, 404, { error: 'Email not found' }); return true; }
      sseBroadcast({ type: 'email_allowlist_update', allowlist: this.deps.store.list() });
      json(res, 200, entry);
      return true;
    }

    if (pathname.startsWith('/api/email-allowlist/') && method === 'DELETE') {
      const email   = decodeURIComponent(pathname.replace('/api/email-allowlist/', ''));
      const deleted = await this.deps.store.delete(email);
      if (!deleted) { json(res, 404, { error: 'Email not found' }); return true; }
      sseBroadcast({ type: 'email_allowlist_update', allowlist: this.deps.store.list() });
      res.writeHead(204); res.end();
      return true;
    }

    return false;
  }
}
