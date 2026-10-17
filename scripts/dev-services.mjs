#!/usr/bin/env node
/**
 * Launch the HATS services together for development.
 *
 *   node scripts/dev-services.mjs                 # library + project server + designer + embodiment test
 *   node scripts/dev-services.mjs --with-runner   # also start the Team Runner
 *   node scripts/dev-services.mjs library designer
 *
 * Each child's output is prefixed with its service name. Ctrl+C stops them all.
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Load .env into every child, so running this file directly behaves the same as
// `npm run services`. Without it the services would pick different defaults for
// PROJECTS_ROOT than the Team Runner does.
const ENV_FILE = path.join(REPO_ROOT, '.env');
const ENV_ARGS = existsSync(ENV_FILE) ? [`--env-file=${ENV_FILE}`] : [];

const SERVICES = {
  library:   { label: 'library  ', script: 'apps/agent-library/src/main.ts',    port: 3010, colour: '\x1b[36m' },
  projects:  { label: 'projects ', script: 'apps/project-server/src/main.ts',   port: 3020, colour: '\x1b[35m' },
  designer:  { label: 'designer ', script: 'apps/project-designer/src/main.ts', port: 3030, colour: '\x1b[33m' },
  embodiment:{ label: 'embodied ', script: 'apps/embodiment-test/src/main.ts',  port: 3040, colour: '\x1b[32m' },
  speech:    { label: 'speech   ', script: 'apps/speech-service/src/main.ts',   port: 3050, colour: '\x1b[31m' },
  companion: { label: 'companion', script: 'apps/companion/src/main.ts',        port: 3060, colour: '\x1b[95m' },
  runner:    { label: 'runner   ', script: 'team-runner.ts',                    port: 3001, colour: '\x1b[34m' },
};

const RESET = '\x1b[0m';
const DEFAULT_SET = ['library', 'projects', 'designer', 'embodiment', 'speech'];

function chosenServices(argv) {
  const named = argv.filter((a) => !a.startsWith('--'));
  if (named.length > 0) return named.filter((name) => name in SERVICES);
  return argv.includes('--with-runner') ? [...DEFAULT_SET, 'runner'] : DEFAULT_SET;
}

const selected = chosenServices(process.argv.slice(2));
if (selected.length === 0) {
  console.error(`No known services selected. Available: ${Object.keys(SERVICES).join(', ')}`);
  process.exit(1);
}

const children = [];

for (const name of selected) {
  const service = SERVICES[name];
  const child = spawn(
    process.execPath,
    [...ENV_ARGS, '--import', 'tsx/esm', path.join(REPO_ROOT, service.script)],
    { cwd: REPO_ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
  );

  const prefix = `${service.colour}[${service.label}]${RESET} `;
  const pipe = (stream, target) => {
    stream.setEncoding('utf-8');
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) target.write(`${prefix}${line}\n`);
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);

  child.on('exit', (code, signal) => {
    process.stdout.write(`${prefix}exited (${signal ?? code})\n`);
  });

  children.push({ name, child });
  console.log(`${prefix}starting ${service.script} on port ${service.port}`);
}

const shutdown = () => {
  for (const { child } of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(0), 500);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
