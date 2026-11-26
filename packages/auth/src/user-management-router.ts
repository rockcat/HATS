import type { IncomingMessage, ServerResponse } from 'http';
import type { UserStore } from './user-store.js';
import { parseRequestAuth } from './auth-middleware.js';
import { readJsonBody } from '../../service-kit/src/http.js';

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

export class UserManagementRouter {
  constructor(private readonly userStore: UserStore) {}

  async handleRoutes(pathname: string, method: string, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (!pathname.startsWith('/api/users')) return false;

    const session = parseRequestAuth(req, this.userStore);
    if (!session) { json(res, 401, { error: 'Not authenticated' }); return true; }

    // GET /api/users
    if (pathname === '/api/users' && method === 'GET') {
      if (session.role !== 'admin') { json(res, 403, { error: 'Admin only' }); return true; }
      json(res, 200, this.userStore.getAll().map(u => this.userStore.toPublic(u)));
      return true;
    }

    // POST /api/users
    if (pathname === '/api/users' && method === 'POST') {
      if (session.role !== 'admin') { json(res, 403, { error: 'Admin only' }); return true; }
      const { username, password, role } = ((await readJsonBody<Record<string, string>>(req)) ?? {});
      if (!username?.trim() || !password) { json(res, 400, { error: 'username and password required' }); return true; }
      try {
        const u = await this.userStore.createUser(username.trim(), password, role === 'admin' ? 'admin' : 'user');
        json(res, 201, this.userStore.toPublic(u));
      } catch (e) { json(res, 409, { error: (e as Error).message }); }
      return true;
    }

    // PUT /api/users/:id — change password or role (admin, or self for password)
    const idMatch = pathname.match(/^\/api\/users\/([^/]+)$/);
    if (idMatch && method === 'PUT') {
      const targetId = idMatch[1];
      if (session.userId !== targetId && session.role !== 'admin') {
        json(res, 403, { error: 'Forbidden' }); return true;
      }
      const { password, role } = ((await readJsonBody<Record<string, string>>(req)) ?? {});
      try {
        if (password) await this.userStore.updatePassword(targetId, password);
        if (role && session.role === 'admin')
          await this.userStore.updateRole(targetId, role === 'admin' ? 'admin' : 'user');
        const u = this.userStore.getById(targetId);
        if (!u) { json(res, 404, { error: 'Not found' }); return true; }
        json(res, 200, this.userStore.toPublic(u));
      } catch (e) { json(res, 400, { error: (e as Error).message }); }
      return true;
    }

    // DELETE /api/users/:id
    if (idMatch && method === 'DELETE') {
      if (session.role !== 'admin') { json(res, 403, { error: 'Admin only' }); return true; }
      if (session.userId === idMatch[1]) { json(res, 400, { error: 'Cannot delete your own account' }); return true; }
      try {
        await this.userStore.deleteUser(idMatch[1]);
        json(res, 200, { ok: true });
      } catch (e) { json(res, 404, { error: (e as Error).message }); }
      return true;
    }

    // DELETE /api/users/:id/api-keys/:keyId
    const keyMatch = pathname.match(/^\/api\/users\/([^/]+)\/api-keys\/([^/]+)$/);
    if (keyMatch && method === 'DELETE') {
      const [, targetId, keyId] = keyMatch;
      if (session.userId !== targetId && session.role !== 'admin') {
        json(res, 403, { error: 'Forbidden' }); return true;
      }
      try {
        await this.userStore.revokeApiKey(targetId, keyId);
        json(res, 200, { ok: true });
      } catch (e) { json(res, 400, { error: (e as Error).message }); }
      return true;
    }

    return false;
  }
}
