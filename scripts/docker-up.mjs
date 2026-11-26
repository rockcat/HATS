#!/usr/bin/env node
/**
 * Build everything from this checkout and run it in Docker.
 *
 *   npm run docker:up      # build and start the runner and the services
 *   npm run docker:down    # stop them all
 *
 * The runner (docker-compose.yml) and the services (docker-compose.services.yml)
 * are separate compose projects, so each can be restarted without the other.
 * This starts both, then waits until the runner answers on :3001.
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The two stacks, in start order. Each is the arguments that select its compose file. */
const STACKS = [
  { name: 'runner', files: ['-f', 'docker-compose.yml'] },
  { name: 'services', files: ['-f', 'docker-compose.services.yml'] },
];

// docker-compose.yml always publishes the runner on 3001.
const RUNNER_URL = 'http://localhost:3001';
const WAIT_MS = 180_000;
const POLL_MS = 2_000;

/** Run docker with the given arguments in the repo root; resolves to its exit code. */
const runDocker = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn('docker', args, { cwd: REPO_ROOT, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });

/** True once the runner replies below 500: /api/ needs a login, so a 401 means alive. */
const runnerAnswers = async (url) => {
  try {
    const res = await fetch(`${url}/api/state`, { signal: AbortSignal.timeout(3_000) });
    return res.status < 500;
  } catch {
    return false;
  }
};

const waitForRunner = async (url, deadline) => {
  while (Date.now() < deadline) {
    if (await runnerAnswers(url)) return true;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return false;
};

const up = async () => {
  if (!existsSync(path.join(REPO_ROOT, '.env'))) {
    console.error('No .env in the repo root. Both compose files read it; create it first (see README).');
    return 1;
  }
  for (const stack of STACKS) {
    console.log(`\n== Building and starting the ${stack.name}`);
    const code = await runDocker(['compose', ...stack.files, 'up', '-d', '--build']);
    if (code !== 0) {
      console.error(`docker compose failed for the ${stack.name} (exit ${code}).`);
      return code;
    }
  }
  console.log(`\n== Waiting for the runner at ${RUNNER_URL}`);
  if (!(await waitForRunner(RUNNER_URL, Date.now() + WAIT_MS))) {
    console.error(`The runner did not answer within ${WAIT_MS / 1000}s. See: docker compose logs hats`);
    return 1;
  }
  console.log(`\nAll up. Dashboard: ${RUNNER_URL}`);
  return 0;
};

const down = async () => {
  let worst = 0;
  // Services first, so nothing is left calling a runner that has gone.
  for (const stack of [...STACKS].reverse()) {
    console.log(`\n== Stopping the ${stack.name}`);
    const code = await runDocker(['compose', ...stack.files, 'down']);
    if (code !== 0) worst = code;
  }
  return worst;
};

const command = process.argv[2] ?? 'up';
const actions = { up, down };
if (!actions[command]) {
  console.error(`Unknown command "${command}". Use: up | down`);
  process.exit(2);
}
process.exit(await actions[command]());
