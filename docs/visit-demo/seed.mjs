#!/usr/bin/env node
/**
 * Set up the "Real numbers for the pricing page" visit demo. See README.md
 * beside this file.
 *
 *   node --env-file=.env docs/visit-demo/seed.mjs            # set up, keeping what is there
 *   node --env-file=.env docs/visit-demo/seed.mjs --reset    # start again from nothing
 *
 * Two steps:
 *
 *   1. On the Project Server: the two teams, Website and Insights, each with
 *      one agent and with visit settings that let Website visit Insights.
 *   2. On each team's runner, once it is running: the sales file in
 *      Insights' project files, and the pricing-page ticket on Website's board.
 *
 * Step 2 is skipped, with a note, for a runner that is not running yet. Start
 * the runners and run this again: everything already there is left alone.
 *
 * Environment:
 *   PROJECT_SERVER_URL    default http://localhost:3020
 *   WEBSITE_RUNNER_URL    default http://localhost:3071
 *   INSIGHTS_RUNNER_URL   default http://localhost:3072
 *   HATS_API_KEY, or HATS_ADMIN_USERNAME / HATS_ADMIN_PASSWORD, to sign in to the runners
 *   DEMO_PROVIDER / DEMO_MODEL   the agents' model, default anthropic / $ANTHROPIC_MODEL
 */

import { randomUUID } from 'crypto';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import * as path from 'path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SALES_FILE = 'sales-2026-q3.csv';
const trim = (url) => url.replace(/\/$/, '');
const PROJECT_SERVER = trim(process.env['PROJECT_SERVER_URL'] ?? 'http://localhost:3020');
const RUNNERS = {
  website: trim(process.env['WEBSITE_RUNNER_URL'] ?? 'http://localhost:3071'),
  insights: trim(process.env['INSIGHTS_RUNNER_URL'] ?? 'http://localhost:3072'),
};
const MODEL = {
  provider: process.env['DEMO_PROVIDER'] ?? 'anthropic',
  model: process.env['DEMO_MODEL'] ?? process.env['ANTHROPIC_MODEL'] ?? 'claude-haiku-5-5',
};

// ── What the demo is made of ─────────────────────────────────────────────────

/** A deployed agent written in place, without a library template. */
const agent = (name, hats, identity) => ({
  schemaVersion: 1,
  instanceId: randomUUID(),
  name,
  hats,
  identity,
  model: MODEL,
  enabled: true,
  deployedAt: new Date().toISOString(),
});

const TEAMS = [
  {
    id: 'website',
    name: 'Website',
    goal: 'Build and look after the company website, starting with a new pricing page.',
    settings: {
      summary: 'Builds the company website.',
      tags: ['website', 'frontend'],
      visits: { visitTo: ['insights'], maxHours: 1 },
    },
    agent: () => agent('Wren', ['green', 'blue'], {
      visualDescription: 'Quick, tidy and practical',
      specialisation: 'Front-end developer',
      backstory: 'Builds web pages, and likes the numbers on them to be true.',
    }),
  },
  {
    id: 'insights',
    name: 'Insights',
    goal: 'Answer questions about sales and usage from the data this team holds.',
    settings: {
      summary: 'Sales and usage analysis. Holds the company sales exports; they stay with this team.',
      tags: ['data', 'sales', 'analysis'],
      visits: { hostFrom: ['website'], approval: 'admin', maxHours: 1, memoryHome: 'summary' },
    },
    agent: () => agent('Iris', ['white', 'black'], {
      visualDescription: 'Careful and precise',
      specialisation: 'Data analyst',
      backstory: 'Looks after the sales data, and who gets to see it.',
    }),
  },
];

const TICKET = {
  title: 'Pricing page: show our three most popular plans with real figures',
  description: [
    'The new pricing page should lead with our three most popular plans.',
    '',
    'We need, for each: the plan name, its monthly price, and its share of last quarter\'s sales.',
    'We do not hold the sales data on this team: the **Insights** team does.',
    '',
    'Done when the figures on the page come from real sales, not guesses.',
  ].join('\n'),
  priority: 'high',
  column: 'backlog',
  assignee: 'Wren',
  tags: ['pricing-page'],
};

// ── Talking to the services ──────────────────────────────────────────────────

async function call(url, init = {}) {
  const response = await fetch(url, init).catch((err) => ({ ok: false, status: 0, error: err }));
  const body = response.status === 0 || response.status === 204 ? undefined : await response.json().catch(() => undefined);
  return { ok: response.ok, status: response.status, body };
}

const jsonBody = (method, value, headers = {}) => ({
  method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value),
});

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

// ── Step 1: the teams, on the Project Server ─────────────────────────────────

/**
 * Visits outlive the teams they join, so a reset closes the open ones first:
 * left open, a request from an agent that no longer exists waits at the host.
 */
async function cancelOpenVisits(team) {
  const open = await call(`${PROJECT_SERVER}/api/v1/visits?project=${team.id}&open=true`);
  for (const visit of open.body?.visits ?? []) {
    const done = await call(`${PROJECT_SERVER}/api/v1/visits/${visit.id}/cancel`,
      jsonBody('POST', { note: 'The demo was reset.' }));
    if (done.ok) console.log(`  cancelled ${visit.agent?.name ?? 'an agent'}'s visit, ${visit.home} → ${visit.host}`);
  }
}

async function ensureTeam(team, reset) {
  const url = `${PROJECT_SERVER}/api/v1/projects/${team.id}`;
  let existing = await call(url);
  if (existing.status === 0) fail(`Could not reach the Project Server at ${PROJECT_SERVER}.`);

  if (existing.ok && reset) {
    await cancelOpenVisits(team);
    await call(`${url}?purge=true`, { method: 'DELETE' });
    existing = { ok: false, status: 404 };
    console.log(`  removed ${team.name}, to start again`);
  }
  if (!existing.ok) {
    const created = await call(`${PROJECT_SERVER}/api/v1/projects`,
      jsonBody('POST', { id: team.id, name: team.name, goal: team.goal }));
    if (!created.ok) fail(`Could not create ${team.name}: ${created.body?.error ?? created.status}`);
    console.log(`  created ${team.name}`);
  }

  const current = (await call(url)).body;
  const patched = await call(url, jsonBody('PATCH', {
    goal: team.goal,
    settings: { ...current.settings, ...team.settings },
  }));
  if (!patched.ok) fail(`Could not set ${team.name}'s visit settings: ${patched.body?.error ?? patched.status}`);

  const member = team.agent();
  if (current.team.some((a) => a.name.toLowerCase() === member.name.toLowerCase())) {
    console.log(`  ${member.name} is already on ${team.name}`);
    return;
  }
  const deployed = await call(`${url}/team`, jsonBody('POST', { agent: member }));
  if (!deployed.ok) fail(`Could not add ${member.name} to ${team.name}: ${deployed.body?.error ?? deployed.status}`);
  console.log(`  added ${member.name} to ${team.name}`);
}

// ── Step 2: the file and the ticket, on the runners ──────────────────────────

async function adminLogin(runner) {
  const login = await call(`${runner}/api/auth/login`, jsonBody('POST', {
    username: process.env['HATS_ADMIN_USERNAME'] ?? 'admin',
    password: process.env['HATS_ADMIN_PASSWORD'] ?? 'changeme',
  }));
  return login.ok ? { Authorization: `Bearer ${login.body.token}` } : undefined;
}

/**
 * Signed in, and what the runner is running. The API key first; a key is
 * issued by one runner, so a new runner with its own data folder may not know
 * it, and the admin login is tried next.
 */
async function signIn(runner) {
  const key = process.env['HATS_API_KEY'];
  const tries = [key && (async () => ({ 'X-API-Key': key })), adminLogin].filter(Boolean);
  for (const attempt of tries) {
    const auth = await attempt(runner);
    const project = auth && await call(`${runner}/api/project`, { headers: auth });
    if (project?.status === 0) return undefined;
    if (project?.ok) return { auth, project: project.body };
  }
  return undefined;
}

/** The runner's sign-in, or undefined with a note when it is not running this team. */
async function runnerFor(teamId) {
  const runner = RUNNERS[teamId];
  const signedIn = await signIn(runner);
  if (!signedIn) {
    console.log(`  - could not reach or sign in to the ${teamId} runner at ${runner}: start it, then run this again`);
    return undefined;
  }
  const { auth, project } = signedIn;
  const running = project?.id;
  if (running && running !== teamId) {
    console.log(`  - the runner at ${runner} is running "${running}", not ${teamId}: skipped`);
    return undefined;
  }
  return { runner, auth };
}

async function addSalesFile() {
  const at = await runnerFor('insights');
  if (!at) return;
  const files = await call(`${at.runner}/api/project/files`, { headers: at.auth });
  if (files.body?.sources?.some((f) => f.name === SALES_FILE)) {
    console.log(`  ${SALES_FILE} is already in Insights' files`);
    return;
  }
  const uploaded = await call(`${at.runner}/api/project/upload`, {
    method: 'POST',
    headers: { ...at.auth, 'X-Filename': SALES_FILE, 'Content-Type': 'text/csv' },
    body: await readFile(path.join(HERE, SALES_FILE)),
  });
  if (!uploaded.ok) fail(`Could not add ${SALES_FILE} to Insights: ${uploaded.body?.error ?? uploaded.status}`);
  console.log(`  added ${SALES_FILE} to Insights' files`);
}

async function addTicket() {
  const at = await runnerFor('website');
  if (!at) return;
  const made = await call(`${at.runner}/api/kanban/tickets`, jsonBody('POST', TICKET, at.auth));
  if (made.status === 409) { console.log(`  the pricing-page ticket is already there: ${made.body.existing.id}`); return; }
  if (!made.ok) fail(`Could not add the ticket to Website: ${made.body?.error ?? made.status}`);
  console.log(`  added ${made.body.id} to Website's board, for Wren`);
}

// ── ───────────────────────────────────────────────────────────────────────────

const reset = process.argv.includes('--reset');
console.log(`Teams, on the Project Server at ${PROJECT_SERVER}:`);
for (const team of TEAMS) await ensureTeam(team, reset);
console.log('Files and tickets, on the runners:');
await addSalesFile();
await addTicket();
console.log('Done. See docs/visit-demo/README.md for the demo itself.');
