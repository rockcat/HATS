import { IncomingMessage, ServerResponse } from 'http';
import { EmailAllowlistStore, EmailAllowlistEntry } from './email-allowlist-store.js';

export interface EmailAllowlistRouterDeps {
  store: EmailAllowlistStore;
  sseBroadcast(data: object): void;
  json(res: ServerResponse, status: number, body: unknown): void;
  readBody(req: IncomingMessage): Promise<string>;
  /** Called when an entry transitions to approved or rejected so the agent can be notified. */
  onStatusChange?(entry: EmailAllowlistEntry): void;
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
      const emails  = fields.email?.trim().toLowerCase().split(',').map(e => e.trim()).filter(Boolean);
      if (!emails?.length) { json(res, 400, { error: 'email is required' }); return true; }
      // filter any existing
      const newEmails = emails.filter(email => !this.deps.store.get(email));
      if (!newEmails.length) { json(res, 409, { error: 'All emails already in allowlist' }); return true; }
      for (const email of newEmails) {
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
      }
      sseBroadcast({ type: 'email_allowlist_update', allowlist: this.deps.store.list() });
      json(res, 201, newEmails.map(email => this.deps.store.get(email)));
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
      if (this.deps.onStatusChange && entry.requestedBy && entry.requestedBy !== 'human') {
        this.deps.onStatusChange(entry);
        await this.deps.store.markNotified([entry.email]);
      }
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
