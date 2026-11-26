import type { UserStore } from './user-store.js';
import { log } from '../../core/src/logger.js';

/**
 * Make the first admin from HATS_ADMIN_USERNAME and HATS_ADMIN_PASSWORD when
 * there are no users yet, so a new installation can be signed in to. Whatever
 * holds the users does it: a runner on its own, or the auth service.
 */
export async function ensureFirstAdmin(
  userStore: UserStore, env: Record<string, string | undefined> = process.env,
): Promise<void> {
  if (!userStore.isEmpty()) return;
  const username = env['HATS_ADMIN_USERNAME'] ?? 'admin';
  await userStore.createUser(username, env['HATS_ADMIN_PASSWORD'] ?? 'changeme', 'admin');
  log.info(`[Auth] Created initial admin user: ${username}`);
  if (!env['HATS_ADMIN_PASSWORD']) {
    log.warn('[Auth] WARNING: Using default password "changeme" — set HATS_ADMIN_PASSWORD in .env');
  }
}
