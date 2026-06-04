#!/usr/bin/env node
// Update AI model pricing data by reading provider pricing pages with Claude Haiku.
// Usage: node tools/update-pricing.mjs
// Requires ANTHROPIC_API_KEY in environment (or .env file).

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const tool = path.join(root, 'src', 'tools', 'pricing-updater.ts');

const child = spawn('npx', ['tsx', '--env-file=.env', tool], {
  stdio: 'inherit',
  cwd: root,
  shell: process.platform === 'win32',
});

child.on('error', err => { console.error('Failed to start:', err.message); process.exit(1); });
child.on('exit', code => process.exit(code ?? 0));
