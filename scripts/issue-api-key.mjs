#!/usr/bin/env node
/**
 * Mint an API key for the Team Runner and print it.
 *
 *   node --env-file=.env scripts/issue-api-key.mjs [username] [password]
 *
 * The runner authenticates all of /api/*, so the Agent Template Library's chat tab and
 * the Embodiment API test harness both need a key in HATS_API_KEY. Keys are
 * issued by the mobile-pairing flow — this drives that flow from the terminal
 * so you do not have to scan a QR code to get one.
 *
 * The Team Runner must be running.
 */

const RUNNER = (process.env['TEAM_RUNNER_URL'] ?? 'http://localhost:3001').replace(/\/$/, '');
const username = process.argv[2] ?? process.env['HATS_ADMIN_USERNAME'] ?? 'admin';
const password = process.argv[3] ?? process.env['HATS_ADMIN_PASSWORD'] ?? 'changeme';

async function main() {
  const login = await fetch(`${RUNNER}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  }).catch(() => null);

  if (!login) {
    console.error(`Could not reach the Team Runner at ${RUNNER}. Start it with: npm start`);
    process.exit(1);
  }
  if (!login.ok) {
    console.error(`Login failed for "${username}" (${login.status}).`);
    console.error('Pass the credentials explicitly: node scripts/issue-api-key.mjs <username> <password>');
    process.exit(1);
  }

  const { token } = await login.json();
  const auth = { Authorization: `Bearer ${token}` };

  const generated = await fetch(`${RUNNER}/api/auth/pair/generate`, { method: 'POST', headers: auth });
  if (!generated.ok) {
    console.error(`Could not generate a pairing token (${generated.status}).`);
    process.exit(1);
  }

  // The response carries the token outright, alongside a url and every
  // candidate address the QR could encode. Only the token matters here —
  // this script is already on the machine the runner is on.
  const generatedBody = await generated.json();
  const pairToken = generatedBody.token
    ?? String(generatedBody.url ?? generatedBody.pairUrl ?? '').split('/').pop();

  if (!pairToken) {
    console.error('The runner did not return a pairing token. Response keys: '
      + Object.keys(generatedBody).join(', '));
    process.exit(1);
  }

  const claimed = await fetch(`${RUNNER}/api/auth/pair/${pairToken}`);
  if (!claimed.ok) {
    console.error(`Could not claim the pairing token (${claimed.status}).`);
    process.exit(1);
  }

  const { apiKey, keyId } = await claimed.json();
  console.log(`\nAPI key issued for "${username}" (key id ${keyId}):\n`);
  console.log(`  HATS_API_KEY=${apiKey}\n`);
  console.log('Paste that line into .env, then restart the Agent Template Library and the');
  console.log('Embodiment API test harness. Revoke it any time from the dashboard\'s');
  console.log('Settings → Users panel.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
