#!/usr/bin/env node
/**
 * Build everything from this checkout and run it in Docker.
 *
 *   npm run docker:up      # build and start the services, then the runner
 *   npm run docker:down    # stop them all
 *
 * The runner (docker-compose.yml) and the services (docker-compose.services.yml)
 * are separate compose projects, so each can be restarted without the other.
 *
 * The services go first. The runner looks for the Agent Library once, when it
 * starts; if the library is not answering yet it falls back to a local
 * agents.json and keeps that until it is restarted, showing only the built-in
 * agents. So each stack is waited on before the next one starts.
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const WAIT_MS = 180_000;
const POLL_MS = 2_000;

/** True when `url` replies and `accept` approves the response. Any network error is false. */
const answers = async (url, accept) => {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3_000) });
    return await accept(res);
  } catch {
    return false;
  }
};

/**
 * The two stacks, in start order. `ready` is where to look once it is up, and
 * what counts as an answer. The ports are the ones the compose files publish.
 */
const STACKS = [
  {
    name: 'services',
    files: ['-f', 'docker-compose.services.yml'],
    ready: {
      what: 'the Agent Library',
      url: 'http://localhost:3010/api/v1/health',
      accept: async (res) => res.ok && (await res.json())?.ok === true,
      logs: 'docker compose -f docker-compose.services.yml logs agent-library',
    },
  },
  {
    name: 'runner',
    files: ['-f', 'docker-compose.yml'],
    ready: {
      what: 'the runner',
      // /api/ needs a login, so a 401 means alive: anything under 500 will do.
      url: 'http://localhost:3001/api/state',
      accept: async (res) => res.status < 500,
      logs: 'docker compose logs hats',
    },
  },
];

/** Run docker with the given arguments in the repo root; resolves to its exit code. */
const runDocker = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn('docker', args, { cwd: REPO_ROOT, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });

const waitFor = async ({ url, accept }, deadline) => {
  while (Date.now() < deadline) {
    if (await answers(url, accept)) return true;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return false;
};

const up = async () => {
  if (!existsSync(path.join(REPO_ROOT, '.env'))) {
    console.error('No .env in the repo root. Both compose files read it; create it first (see README).');
    return 1;
  }
  for (const { name, files, ready } of STACKS) {
    console.log(`\n== Building and starting the ${name}`);
    const code = await runDocker(['compose', ...files, 'up', '-d', '--build']);
    if (code !== 0) {
      console.error(`docker compose failed for the ${name} (exit ${code}).`);
      return code;
    }
    console.log(`\n== Waiting for ${ready.what}`);
    if (!(await waitFor(ready, Date.now() + WAIT_MS))) {
      console.error(`${ready.what} did not answer within ${WAIT_MS / 1000}s. See: ${ready.logs}`);
      return 1;
    }
  }
  console.log('\nAll up. Dashboard: http://localhost:3001');
  return 0;
};

const down = async () => {
  let worst = 0;
  // The runner first, the reverse of starting.
  for (const { name, files } of [...STACKS].reverse()) {
    console.log(`\n== Stopping the ${name}`);
    const code = await runDocker(['compose', ...files, 'down']);
    if (code !== 0) worst = code;
  }
  return worst;
};

const command = process.argv[2] ?? 'up';
const actions = { up, down };
if (!actions[command]) {
  console.error(`Unknown command "${command}". Use: up | down`);
  process.exitCode = 2;
} else {
  // exitCode, not exit(): exiting with fetch's sockets still open trips a
  // libuv assertion on Windows.
  process.exitCode = await actions[command]();
}
