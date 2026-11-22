/**
 * HATS auth service.
 *
 * The dashboard's users, sessions, API keys and phone pairing, held once for
 * every runner. A runner given AUTH_SERVICE_URL checks each request here and
 * forwards its sign-in routes here, so one sign-in works on all of them.
 *
 * It runs the same AuthRouter and UserManagementRouter a runner on its own
 * runs, over the same files (data/users.json, data/sessions.json), so an
 * installation that had one runner keeps its users when it starts sharing.
 *
 * Start it with `npm run auth-service`.
 */

import { metaRoutes, route, startService, type Route } from '@hats/service-kit/index';
import { runtimeDir } from '@hats/core/runtime-dir';
import { UserStore } from '@hats/auth/user-store';
import { loadSessions } from '@hats/auth/auth-middleware';
import { AuthRouter } from '@hats/auth/auth-router';
import { UserManagementRouter } from '@hats/auth/user-management-router';
import { ensureFirstAdmin } from '@hats/auth/first-admin';

const config = {
  name: 'AuthService',
  version: '1.0.0',
  port: Number(process.env['AUTH_SERVICE_PORT'] ?? 3090),
} as const;

async function main(): Promise<void> {
  const users = new UserStore(runtimeDir('data', 'users.json'));
  await users.load();
  await loadSessions(runtimeDir('data', 'sessions.json'));
  await ensureFirstAdmin(users);

  const auth = new AuthRouter(users, config.port);
  const accounts = new UserManagementRouter(users);

  // The routers match their own paths, as they do inside a runner.
  const dispatch: Route[] = ['GET', 'POST', 'PUT', 'DELETE'].map((method) =>
    route(method, '/api/*rest', async ({ req, res, url }) => {
      if (await auth.handleRoutes(url.pathname, method, req, res)) return;
      if (await accounts.handleRoutes(url.pathname, method, req, res)) return;
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }));

  await startService({
    name: config.name,
    port: config.port,
    routes: [
      ...metaRoutes({
        base: '/api/v1',
        health: () => ({ service: 'auth-service', version: config.version, users: users.getAll().length }),
      }),
      ...dispatch,
    ],
    banner: [`users: ${runtimeDir('data', 'users.json')}`],
  });
}

main().catch((err) => {
  console.error('[AuthService] failed to start:', err);
  process.exit(1);
});
