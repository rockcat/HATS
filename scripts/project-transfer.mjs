#!/usr/bin/env node
/**
 * Move a project between machines as one zip.
 *
 *   node --env-file=.env scripts/project-transfer.mjs export <project-id> [--credentials] [--out <file>]
 *   node --env-file=.env scripts/project-transfer.mjs import <file.zip> [--as <new-id>]
 *
 * The zip holds the project folder, its team definition, its agents' library
 * templates, their scheduled actions and the avatars they use. Agents' mail
 * and calendar credentials are left out unless --credentials is given — the
 * zip is then as sensitive as a password file.
 *
 * Import adds to what the machine already has and never overwrites it: an
 * existing project with the same id is refused (use --as), and agents already
 * in the library keep their current template and credentials.
 *
 * The Team Runner must be running on both machines, with the Project Server
 * and Agent Library. Signs in as an admin with HATS_API_KEY, or with
 * HATS_ADMIN_USERNAME / HATS_ADMIN_PASSWORD.
 */

import { readFile, writeFile } from 'fs/promises';

const RUNNER = (process.env['TEAM_RUNNER_URL'] ?? 'http://localhost:3001').replace(/\/$/, '');

function usage(message) {
  if (message) console.error(message);
  console.error('Usage:');
  console.error('  project-transfer.mjs export <project-id> [--credentials] [--out <file>]');
  console.error('  project-transfer.mjs import <file.zip> [--as <new-id>]');
  process.exit(1);
}

function option(args, name) {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (!value || value.startsWith('--')) usage(`${name} needs a value`);
  return value;
}

async function authHeader() {
  const key = process.env['HATS_API_KEY'];
  if (key) return { 'X-API-Key': key };

  const username = process.env['HATS_ADMIN_USERNAME'] ?? 'admin';
  const password = process.env['HATS_ADMIN_PASSWORD'] ?? 'changeme';
  const login = await fetch(`${RUNNER}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  }).catch(() => null);
  if (!login) { console.error(`Could not reach the Team Runner at ${RUNNER}.`); process.exit(1); }
  if (!login.ok) { console.error(`Login failed for "${username}" (${login.status}).`); process.exit(1); }
  const { token } = await login.json();
  return { Authorization: `Bearer ${token}` };
}

async function failed(response) {
  const body = await response.json().catch(() => ({}));
  console.error(`Failed (${response.status}): ${body.error ?? response.statusText}`);
  process.exit(1);
}

async function exportProject(args) {
  const id = args[0];
  if (!id || id.startsWith('--')) usage('Which project?');
  const credentials = args.includes('--credentials');
  const out = option(args, '--out') ?? `${id.replace(/[^A-Za-z0-9_-]/g, '_')}.hats.zip`;

  const response = await fetch(
    `${RUNNER}/api/projects/${encodeURIComponent(id)}/export${credentials ? '?credentials=true' : ''}`,
    { headers: await authHeader() },
  );
  if (!response.ok) await failed(response);

  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(out, bytes);
  console.log(`Exported "${id}" to ${out} (${(bytes.length / 1e6).toFixed(1)} MB)`);
  if (credentials) console.log('It includes agents\' credentials: keep it somewhere safe, and delete it once imported.');
}

async function importProject(args) {
  const file = args[0];
  if (!file || file.startsWith('--')) usage('Which file?');
  const as = option(args, '--as');

  const response = await fetch(`${RUNNER}/api/projects/import${as ? `?as=${encodeURIComponent(as)}` : ''}`, {
    method: 'POST',
    headers: { ...(await authHeader()), 'Content-Type': 'application/zip' },
    body: await readFile(file),
  });
  if (!response.ok) await failed(response);

  const r = await response.json();
  console.log(`Imported "${r.projectId}".`);
  console.log(`  Agents added to the library:  ${r.templates.created.join(', ') || 'none'}`);
  if (r.templates.kept.length) console.log(`  Already in the library, kept: ${r.templates.kept.join(', ')}`);
  console.log(`  Agents given credentials:     ${r.secrets.length}`);
  console.log(`  Scheduled actions added:      ${r.scheduledActions.added} (${r.scheduledActions.kept} already here)`);
  console.log(`  Avatars added:                ${r.assets.added.length} (${r.assets.kept.length} already here)`);
  if (r.missingVoices.length) console.log(`  Voices to install:            ${r.missingVoices.join(', ')}`);
  for (const w of r.warnings) console.log(`  Note: ${w}`);
  console.log('Switch to it from the dashboard\'s project menu.');
}

const [command, ...args] = process.argv.slice(2);
if (command === 'export') await exportProject(args);
else if (command === 'import') await importProject(args);
else usage();
