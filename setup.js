#!/usr/bin/env node
// HATS — universal setup wizard
// Run with:  node setup.js

import { createInterface } from 'readline/promises';
import { spawnSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT  = dirname(fileURLToPath(import.meta.url));
const isWin = process.platform === 'win32';

// ── Terminal colour helpers ───────────────────────────────────────────────────

const isTTY = Boolean(process.stdout.isTTY);
const c = {
  green:  isTTY ? '\x1b[32m' : '', yellow: isTTY ? '\x1b[33m' : '',
  red:    isTTY ? '\x1b[31m' : '', cyan:   isTTY ? '\x1b[36m' : '',
  bold:   isTTY ? '\x1b[1m'  : '', dim:    isTTY ? '\x1b[2m'  : '',
  reset:  isTTY ? '\x1b[0m'  : '',
};

const ok   = (msg) => console.log(`  ${c.green}✓${c.reset} ${msg}`);
const warn = (msg) => console.log(`  ${c.yellow}!${c.reset} ${msg}`);
const fail = (msg) => console.log(`  ${c.red}✗${c.reset} ${msg}`);
const info = (msg) => console.log(`    ${c.dim}${msg}${c.reset}`);
const head = (msg) => console.log(`\n${c.bold}── ${msg}${c.reset}`);
const link = (url) => console.log(`    ${c.cyan}${url}${c.reset}`);

// ── Shell helpers ─────────────────────────────────────────────────────────────

function run(cmd, args = []) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: true, cwd: ROOT });
  return result.status === 0;
}

function probe(cmd) {
  return spawnSync(cmd, ['--version'], { stdio: 'pipe', shell: true }).status === 0;
}

function probeVersion(cmd) {
  const r = spawnSync(cmd, ['--version'], { stdio: 'pipe', shell: true });
  if (r.status !== 0) return null;
  return r.stdout.toString().trim().split('\n')[0];
}

// ── .env helpers ──────────────────────────────────────────────────────────────

const ENV_PATH     = `${ROOT}/.env`;
const EXAMPLE_PATH = `${ROOT}/.env.example`;

function readEnvFile() {
  const src = existsSync(ENV_PATH) ? ENV_PATH : EXAMPLE_PATH;
  if (!existsSync(src)) return { lines: [], map: {} };
  const lines = readFileSync(src, 'utf8').split('\n');
  const map = {};
  for (const line of lines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)/);
    if (m) map[m[1]] = m[2];
  }
  return { lines, map };
}

function saveEnvFile(lines, updates) {
  const written = new Set();
  const out = lines.map(line => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)/);
    if (m && updates[m[1]] !== undefined) {
      written.add(m[1]);
      return `${m[1]}=${updates[m[1]]}`;
    }
    return line;
  });
  for (const [k, v] of Object.entries(updates)) {
    if (!written.has(k)) out.push(`${k}=${v}`);
  }
  if (out.at(-1) !== '') out.push('');
  writeFileSync(ENV_PATH, out.join('\n'), 'utf8');
}

// ── Interactive prompts ───────────────────────────────────────────────────────

let rl;

async function ask(label, current = '') {
  const isSet   = Boolean(current) && !current.startsWith('your_');
  const hint    = isSet
    ? `${c.dim} (Enter to keep existing)${c.reset}`
    : `${c.dim} (Enter to skip)${c.reset}`;
  const answer  = (await rl.question(`  ${c.cyan}?${c.reset} ${label}${hint}: `)).trim();
  if (!answer) return isSet ? current : '';
  return answer;
}

async function confirm(msg, defaultYes = false) {
  const hint   = defaultYes ? 'Y/n' : 'y/N';
  const answer = (await rl.question(`\n  ${c.cyan}?${c.reset} ${msg} ${c.dim}(${hint})${c.reset}: `)).trim();
  if (!answer) return defaultYes;
  return answer.toLowerCase().startsWith('y');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function setup() {
  rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log(`
${c.bold}╔══════════════════════════════════════════╗
║           HATS — Setup Wizard            ║
╚══════════════════════════════════════════╝${c.reset}

This script installs everything HATS needs and guides you
through connecting any services you want to use.

Press ${c.bold}Enter${c.reset} at any prompt to skip or keep the current value.
You can run this script again at any time to change settings.`);

  // ── 1. Node.js version ─────────────────────────────────────────────────────
  head('Node.js');
  const nodeVer = probeVersion('node');
  if (!nodeVer) {
    fail('Node.js is not installed.');
    info('Download Node.js 20 (LTS) or newer from:');
    link('https://nodejs.org');
    rl.close(); process.exit(1);
  }
  const nodeMajor = parseInt(nodeVer.replace(/[^0-9].*/, ''), 10);
  if (nodeMajor < 20) {
    fail(`Node.js ${nodeVer} found — version 20 or newer is required.`);
    info('Update at:');
    link('https://nodejs.org');
    rl.close(); process.exit(1);
  }
  ok(`Node.js ${nodeVer}`);

  // ── 2. Install npm packages ─────────────────────────────────────────────────
  head('Installing packages');
  info('Running npm install — may take a minute on a first run…');
  if (!run('npm', ['install'])) {
    fail('npm install failed — check the output above for details.');
    rl.close(); process.exit(1);
  }
  ok('Packages installed');

  // ── 3. Build TypeScript ─────────────────────────────────────────────────────
  head('Building');
  info('Compiling TypeScript…');
  if (!run('npm', ['run', 'build'])) {
    fail('Build failed — check the output above for details.');
    rl.close(); process.exit(1);
  }
  ok('Build complete');

  // ── 4. AI provider keys ─────────────────────────────────────────────────────
  head('AI Provider Keys');
  console.log('\n  HATS needs at least one AI provider key to work.\n');

  const { lines, map } = readEnvFile();
  const updates = {};
  const set = (key, val) => { if (val) updates[key] = val; };

  console.log(`  ${c.bold}Anthropic (Claude)${c.reset} — recommended`);
  link('https://console.anthropic.com/settings/keys');
  set('ANTHROPIC_API_KEY', await ask('ANTHROPIC_API_KEY', map.ANTHROPIC_API_KEY));

  console.log(`\n  ${c.bold}OpenAI (GPT-4)${c.reset} — optional`);
  link('https://platform.openai.com/api-keys');
  set('OPENAI_API_KEY', await ask('OPENAI_API_KEY', map.OPENAI_API_KEY));

  console.log(`\n  ${c.bold}Google Gemini${c.reset} — optional`);
  link('https://aistudio.google.com/apikey');
  set('GEMINI_API_KEY', await ask('GEMINI_API_KEY', map.GEMINI_API_KEY));

  const isPlaceholder = (v) => !v || v.startsWith('your_');
  const anyProvider =
    !isPlaceholder(updates.ANTHROPIC_API_KEY ?? map.ANTHROPIC_API_KEY) ||
    !isPlaceholder(updates.OPENAI_API_KEY    ?? map.OPENAI_API_KEY)    ||
    !isPlaceholder(updates.GEMINI_API_KEY    ?? map.GEMINI_API_KEY);
  if (!anyProvider) {
    warn('No AI provider key entered — the app will not work without at least one.');
  }

  // ── 5. Optional MCP services ────────────────────────────────────────────────
  head('Optional Services (MCP)');
  console.log('\n  Connect HATS to external tools and services.');
  console.log('  Say "n" to skip any service — you can enable them later in the app.\n');

  // Brave Search
  if (await confirm('Set up Brave Search (AI-powered web search)?')) {
    info('Free tier available — sign up, then copy your API key.');
    link('https://brave.com/search/api/');
    set('BRAVE_API_KEY', await ask('BRAVE_API_KEY', map.BRAVE_API_KEY));
  }

  // GitHub
  if (await confirm('Set up GitHub (read repos, manage issues & pull requests)?')) {
    info('Create a Personal Access Token — select scopes: repo, read:org');
    link('https://github.com/settings/tokens/new');
    set('GITHUB_PERSONAL_ACCESS_TOKEN',
      await ask('GITHUB_PERSONAL_ACCESS_TOKEN', map.GITHUB_PERSONAL_ACCESS_TOKEN));
  }

  // Slack
  if (await confirm('Set up Slack (post messages, read channels)?')) {
    info('Create a Slack app, install it to your workspace, then copy the Bot Token.');
    link('https://api.slack.com/apps');
    const token  = await ask('SLACK_BOT_TOKEN (starts with xoxb-)', map.SLACK_BOT_TOKEN);
    const teamId = await ask('SLACK_TEAM_ID',                       map.SLACK_TEAM_ID);
    set('SLACK_BOT_TOKEN', token);
    set('SLACK_TEAM_ID',   teamId);
  }

  // Email IMAP
  if (await confirm('Set up Email via IMAP/SMTP (Gmail, Outlook, etc.)?')) {
    info('For Gmail: use an App Password — not your main account password.');
    link('https://myaccount.google.com/apppasswords');
    set('MCP_EMAIL_ADDRESS',  await ask('Email address',             map.MCP_EMAIL_ADDRESS));
    set('MCP_EMAIL_PASSWORD', await ask('Password / App Password',   map.MCP_EMAIL_PASSWORD));
    set('MCP_EMAIL_IMAP_HOST', await ask('IMAP host', map.MCP_EMAIL_IMAP_HOST || 'imap.gmail.com'));
    set('MCP_EMAIL_SMTP_HOST', await ask('SMTP host', map.MCP_EMAIL_SMTP_HOST || 'smtp.gmail.com'));
  }

  // Google Calendar
  if (await confirm('Set up Google Calendar?')) {
    info('Requires a Google Cloud project with the Calendar API enabled.');
    info('Download the OAuth 2.0 "Desktop app" JSON key file, then enter its path.');
    link('https://developers.google.com/calendar/api/quickstart/nodejs');
    set('GOOGLE_OAUTH_CREDENTIALS',
      await ask('Full path to gcp-oauth.keys.json', map.GOOGLE_OAUTH_CREDENTIALS));
  }

  // WhatsApp via Periskope
  if (await confirm('Set up WhatsApp via Periskope (managed API)?')) {
    info('Sign up at Periskope, connect your number, then find your API key and Phone ID.');
    link('https://console.periskope.app');
    set('PERISKOPE_API_KEY',  await ask('PERISKOPE_API_KEY',  map.PERISKOPE_API_KEY));
    set('PERISKOPE_PHONE_ID', await ask('PERISKOPE_PHONE_ID', map.PERISKOPE_PHONE_ID));
  }

  // Twitter / X
  if (await confirm('Set up Twitter / X (post tweets, search)?')) {
    info('Create a developer app and generate OAuth 1.0a keys under "Keys and Tokens".');
    link('https://developer.twitter.com/en/portal/dashboard');
    set('API_KEY',             await ask('API_KEY (Consumer Key)', map.API_KEY));
    set('API_SECRET_KEY',      await ask('API_SECRET_KEY',         map.API_SECRET_KEY));
    set('ACCESS_TOKEN',        await ask('ACCESS_TOKEN',           map.ACCESS_TOKEN));
    set('ACCESS_TOKEN_SECRET', await ask('ACCESS_TOKEN_SECRET',    map.ACCESS_TOKEN_SECRET));
  }

  // Threads
  if (await confirm('Set up Threads by Meta (publish posts, read timeline)?')) {
    info('Create an app at developers.facebook.com, add the Threads API product.');
    link('https://developers.facebook.com/apps');
    set('THREADS_ACCESS_TOKEN', await ask('THREADS_ACCESS_TOKEN', map.THREADS_ACCESS_TOKEN));
    set('THREADS_USER_ID',      await ask('THREADS_USER_ID',      map.THREADS_USER_ID));
  }

  // PostgreSQL
  if (await confirm('Set up a PostgreSQL database connection?')) {
    info('Format: postgresql://username:password@host:5432/database');
    set('POSTGRES_CONNECTION_STRING',
      await ask('Connection string', map.POSTGRES_CONNECTION_STRING));
  }

  // ── 6. Python & uv (POP3 email) ─────────────────────────────────────────────
  head('Python & uv (optional — needed for POP3 email only)');
  const hasPython = probe('python3') || probe('python');
  let   hasUv     = probe('uvx');

  if (!hasPython) {
    warn('Python not found — POP3 email MCP will not be available.');
    info('Install Python 3.12+ from:');
    link('https://python.org/downloads');
  } else {
    ok('Python found');
    if (!hasUv) {
      warn('uv is not installed (needed to run the POP3 email server).');
      if (await confirm('Install uv now?')) {
        const installed = isWin
          ? run('powershell', ['-ExecutionPolicy', 'Bypass', '-Command',
              'irm https://astral.sh/uv/install.ps1 | iex'])
          : run('sh', ['-c', 'curl -LsSf https://astral.sh/uv/install.sh | sh']);
        hasUv = installed && probe('uvx');
        hasUv
          ? ok('uv installed')
          : warn('Restart your terminal after setup for uv to become available in PATH.');
      }
    } else {
      ok('uv / uvx found');
    }

    if (hasUv && await confirm('Set up POP3 email credentials?')) {
      info('For Gmail: use POP3_SERVER=pop.gmail.com with an App Password.');
      set('EMAIL_USER',  await ask('Email address',    map.EMAIL_USER));
      set('EMAIL_PASS',  await ask('App Password',     map.EMAIL_PASS));
      set('POP3_SERVER', await ask('POP3 server host', map.POP3_SERVER || 'pop.gmail.com'));
      set('POP3_PORT',   await ask('POP3 port',        map.POP3_PORT   || '995'));
    }
  }

  // ── 7. Write .env ───────────────────────────────────────────────────────────
  head('Saving configuration');
  saveEnvFile(lines, updates);
  ok(`.env saved`);

  // ── 8. Done ─────────────────────────────────────────────────────────────────
  console.log(`
${c.bold}╔══════════════════════════════════════════╗
║             Setup complete!              ║
╚══════════════════════════════════════════╝${c.reset}

  Start HATS:    ${c.bold}npm start${c.reset}
  Then open:     ${c.cyan}http://localhost:3001${c.reset}

  You can enable, disable, and configure all MCP services in
  the app's ${c.bold}MCP${c.reset} panel — no restart needed.

  Some services (LinkedIn, WhatsApp Web) require additional
  manual steps described in the app's MCP panel.

  Run ${c.bold}node setup.js${c.reset} again at any time to update settings.
`);

  rl.close();
}

setup().catch(err => {
  console.error(`\n${c.red}Setup failed:${c.reset}`, err.message);
  process.exit(1);
});
