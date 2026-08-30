#!/usr/bin/env node
/**
 * Recover per-agent MCP credentials from the legacy agents.json.
 *
 *   node --env-file=.env scripts/recover-agent-credentials.mjs [--dry-run]
 *
 * Credentials are deliberately absent from agent templates and project
 * definitions — a shared library and a shared project store are the wrong place
 * for a secret — so they live in a runner-local sidecar instead. The original
 * import moved everything else across but left these behind.
 *
 * Each set is filed under every id that can identify the agent at runtime: its
 * legacy id (which the import preserved as the template id) and the instanceId
 * of every deployment of it found in the project definitions. That way the
 * credentials resolve whichever way the runner looks them up.
 */

import { existsSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import * as path from 'path';

const DRY_RUN = process.argv.includes('--dry-run');
const PROJECTS_ROOT = path.resolve(
  process.env['PROJECTS_ROOT'] ?? path.join(process.cwd(), 'runtime_data', 'projects'),
);
const DEFINITIONS_DIR = path.resolve(
  process.env['PROJECT_DEFINITIONS_DIR']
    ?? path.join(process.cwd(), 'runtime_data', 'project-server', 'definitions'),
);
const SIDECAR = path.join(PROJECTS_ROOT, 'agent-credentials.json');

const readJson = (file, fallback) => {
  try { return JSON.parse(readFileSync(file, 'utf-8')); } catch { return fallback; }
};

function legacyAgents() {
  const plain = path.join(PROJECTS_ROOT, 'agents.json');
  const migrated = `${plain}.migrated`;
  return readJson(existsSync(plain) ? plain : migrated, []);
}

/** legacy agent id → every deployed instanceId built from it. */
function deploymentsByTemplate() {
  const map = new Map();
  if (!existsSync(DEFINITIONS_DIR)) return map;
  for (const file of readdirSync(DEFINITIONS_DIR).filter((f) => f.endsWith('.json'))) {
    const project = readJson(path.join(DEFINITIONS_DIR, file), null);
    for (const agent of project?.team ?? []) {
      if (!agent.templateId) continue;
      if (!map.has(agent.templateId)) map.set(agent.templateId, new Set());
      map.get(agent.templateId).add(agent.instanceId);
    }
  }
  return map;
}

const agents = legacyAgents();
const deployments = deploymentsByTemplate();
const sidecar = readJson(SIDECAR, {});

console.log(`Legacy agents : ${agents.length}`);
console.log(`Definitions   : ${DEFINITIONS_DIR}`);
console.log(`Sidecar       : ${SIDECAR}`);
if (DRY_RUN) console.log('\n*** DRY RUN — nothing will be written ***');
console.log();

let restored = 0;
for (const agent of agents) {
  const creds = agent.personalMcpCredentials;
  if (!creds || Object.keys(creds).length === 0) continue;

  const ids = new Set([agent.id, ...(deployments.get(agent.id) ?? [])]);
  const servers = Object.keys(creds).join(', ');
  console.log(`  ${agent.identity.name.padEnd(10)} ${servers}`);

  for (const id of ids) {
    const existing = sidecar[id] ?? {};
    // Never clobber credentials already captured at runtime.
    if (existing.personalMcpCredentials) {
      console.log(`      ${id.slice(0, 8)}  already has credentials — left alone`);
      continue;
    }
    sidecar[id] = { ...existing, personalMcpCredentials: creds };
    console.log(`      ${id.slice(0, 8)}  restored`);
    restored++;
  }

  if (agent.disabledPersonalMcpServers?.length) {
    for (const id of ids) {
      sidecar[id] = { ...sidecar[id], disabledPersonalMcpServers: agent.disabledPersonalMcpServers };
    }
  }
}

if (restored === 0) {
  console.log('\nNothing to restore.');
} else if (DRY_RUN) {
  console.log(`\nWould write ${restored} credential set(s).`);
} else {
  writeFileSync(SIDECAR, JSON.stringify(sidecar, null, 2), 'utf-8');
  console.log(`\nWrote ${restored} credential set(s) to the sidecar.`);
}
