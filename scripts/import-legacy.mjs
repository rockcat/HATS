#!/usr/bin/env node
/**
 * Populate the Agent Template Library and Project Server from the existing project data.
 *
 *   node --env-file=.env scripts/import-legacy.mjs [--dry-run]
 *
 * Sources, in order of authority:
 *   <PROJECTS_ROOT>/agents.json          the flat Agent Template Library the runner used
 *   <PROJECTS_ROOT>/<project>/team-state.json
 *       v1 — agents are embedded in the snapshot
 *       v2 — agentIds reference agents.json
 *   <PROJECTS_ROOT>/<project>/project-meta.json   goal and human name
 *
 * Identifiers are preserved: an imported template keeps its original agent id,
 * and a deployed agent keeps it as its instanceId. That is what lets an existing
 * team-state.json still resolve its agents after the import.
 *
 * Writes go through the running services, so everything is schema-validated on
 * the way in. Re-running is safe — existing templates and projects are skipped.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import * as path from 'path';

const DRY_RUN = process.argv.includes('--dry-run');
const PROJECTS_ROOT = path.resolve(process.env['PROJECTS_ROOT'] ?? './projects');
const LIBRARY = (process.env['AGENT_LIBRARY_URL'] ?? 'http://localhost:3010') + '/api/v1';
const PROJECTS = (process.env['PROJECT_SERVER_URL'] ?? 'http://localhost:3020') + '/api/v1';

const VALID_HATS = new Set(['none', 'white', 'red', 'black', 'yellow', 'green', 'blue']);
const VALID_PROVIDERS = new Set(['anthropic', 'openai', 'gemini', 'ollama', 'lmstudio', 'external', 'mock']);
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

const readJson = (file, fallback) => {
  try { return JSON.parse(readFileSync(file, 'utf-8')); } catch { return fallback; }
};

/**
 * The flat library the runner used to own. The Agent Template Library service renames it
 * to `.migrated` once it has imported it, so look for both.
 */
function readLegacyAgents() {
  const plain = path.join(PROJECTS_ROOT, 'agents.json');
  const migrated = `${plain}.migrated`;
  return readJson(existsSync(plain) ? plain : migrated, []);
}

async function callApi(method, url, body) {
  if (DRY_RUN) return { dryRun: true };
  const init = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(url, init);
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const detail = parsed?.details?.map((d) => `${d.path} ${d.message}`).join('; ');
    throw new Error(`${response.status} ${parsed?.error ?? text}${detail ? ` — ${detail}` : ''}`);
  }
  return parsed;
}

// ── Conversion ────────────────────────────────────────────────────────────────

const clean = (obj) => Object.fromEntries(
  Object.entries(obj).filter(([, v]) =>
    v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)),
);

function normaliseHats(hatType) {
  const list = (Array.isArray(hatType) ? hatType : [hatType]).filter((h) => VALID_HATS.has(h));
  return list.length > 0 ? [...new Set(list)] : ['none'];
}

function toIdentity(identity = {}) {
  return clean({
    visualDescription: identity.visualDescription || 'a focused, capable team member',
    specialisation: identity.specialisation,
    backstory: identity.backstory,
    email: identity.email,
    avatar: identity.avatar,
    background: identity.background,
    voice: identity.voice,
    speakerName: identity.speakerName,
  });
}

/** A legacy AgentDefinition (or v1 AgentSnapshot) → an AgentTemplate body. */
function toTemplate(agent, tags) {
  const provider = VALID_PROVIDERS.has(agent.providerName) ? agent.providerName : 'anthropic';
  return clean({
    name: agent.identity?.name?.trim(),
    hats: normaliseHats(agent.hatType),
    identity: toIdentity(agent.identity),
    model: { provider, model: agent.model || 'claude-haiku-4-5-20251001' },
    externalEndpoint: agent.externalEndpoint,
    limits: clean({
      maxContextTokens: agent.maxContextTokens,
      maxCostPerHour: agent.maxCostPerHour,
    }),
    tools: clean({
      enabledMcpServers: agent.enabledMcpServers,
      disabledPersonalMcpServers: agent.disabledPersonalMcpServers,
    }),
    scheduledActionIds: agent.scheduledActionIds ?? [],
    tags,
  });
}

/**
 * The agent record a project actually used → a DeployedAgent document, linked
 * to the library template it came from. Config comes from the project's own
 * record, so a project keeps the model it was running with.
 */
function toDeployedAgent(agent, instanceId, template) {
  const body = toTemplate(agent, undefined);
  return clean({
    schemaVersion: 1,
    instanceId: instanceId ?? template.id,
    templateId: template.id,
    templateRevision: template.revision,
    name: body.name,
    hats: body.hats,
    identity: body.identity,
    model: body.model,
    externalEndpoint: body.externalEndpoint,
    limits: body.limits,
    tools: body.tools,
    scheduledActionIds: body.scheduledActionIds,
    enabled: true,
    deployedAt: new Date().toISOString(),
  });
}

// ── Gathering ─────────────────────────────────────────────────────────────────

function listProjectDirs() {
  if (!existsSync(PROJECTS_ROOT)) return [];
  return readdirSync(PROJECTS_ROOT)
    .filter((name) => {
      try { return statSync(path.join(PROJECTS_ROOT, name)).isDirectory(); } catch { return false; }
    })
    .sort();
}

/** The same person deployed in five projects is one library entry, not five. */
const templateKeyOf = (agent) =>
  `${agent.identity.name.trim().toLowerCase()}:${normaliseHats(agent.hatType).join('+')}`;

/**
 * Every distinct agent across agents.json and the v1 snapshots, deduplicated by
 * name and hats. agents.json is read first so its entry — and its id — wins,
 * which keeps existing v2 team-state.json files resolving after the import.
 */
function gatherAgents(projectDirs) {
  const templates = new Map();   // templateKey → { id, agent, sources }
  const idToKey = new Map();     // every original agent id → its template key

  const add = (agent, source) => {
    if (!agent?.identity?.name) return;
    const key = templateKeyOf(agent);
    const id = IDENTIFIER.test(agent.id ?? '') ? agent.id : null;
    if (id) idToKey.set(id, key);

    const existing = templates.get(key);
    if (existing) {
      existing.sources.add(source);
      // A later sighting can still supply the stable id if the first lacked one.
      if (!existing.id && id) existing.id = id;
      return;
    }
    templates.set(key, { id, agent, sources: new Set([source]) });
  };

  for (const agent of readLegacyAgents()) add(agent, 'library');

  for (const dir of projectDirs) {
    const state = readJson(path.join(PROJECTS_ROOT, dir, 'team-state.json'), null);
    if (state?.version === 1) for (const agent of state.agents ?? []) add(agent, dir);
  }
  return { templates, idToKey };
}

/**
 * Each project's team, carrying the agent record that project actually used.
 * A v1 project keeps its own model and provider even when the canonical library
 * entry has since diverged — the deployed agent is a copy, not a reference.
 */
function gatherProjectTeams(projectDirs, templates, idToKey) {
  const libraryAgents = new Map(
    readLegacyAgents().filter((a) => a?.id).map((a) => [a.id, a]),
  );

  return projectDirs.map((dir) => {
    const state = readJson(path.join(PROJECTS_ROOT, dir, 'team-state.json'), null);
    const meta = readJson(path.join(PROJECTS_ROOT, dir, 'project-meta.json'), {});
    const members = [];
    const unresolved = [];

    const push = (agent, instanceId) => {
      const key = templateKeyOf(agent);
      if (!templates.has(key)) { unresolved.push(agent.identity?.name ?? '?'); return; }
      members.push({ agent, instanceId, templateKey: key });
    };

    if (state?.version === 1) {
      for (const agent of state.agents ?? []) {
        push(agent, IDENTIFIER.test(agent.id ?? '') ? agent.id : undefined);
      }
    } else {
      for (const id of state?.agentIds ?? []) {
        const agent = libraryAgents.get(id);
        if (!agent) { unresolved.push(id); continue; }
        push(agent, id);
      }
    }

    void idToKey;
    return {
      dir,
      goal: meta.goal ?? '',
      humanName: meta.humanName ?? state?.humanName ?? 'Human',
      mcpServers: state?.mcpServers ?? [],
      members,
      unresolved,
      hasState: Boolean(state),
    };
  });
}

// ── Import ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Projects root : ${PROJECTS_ROOT}`);
  console.log(`Agent Template Library : ${LIBRARY}`);
  console.log(`Project Server: ${PROJECTS}`);
  if (DRY_RUN) console.log('\n*** DRY RUN — nothing will be written ***');

  const projectDirs = listProjectDirs();
  const { templates: agents, idToKey } = gatherAgents(projectDirs);
  const projects = gatherProjectTeams(projectDirs, agents, idToKey);

  // ── Templates ──────────────────────────────────────────────────────────────
  const existing = DRY_RUN ? [] : (await callApi('GET', `${LIBRARY}/agent-templates`)).templates;
  const existingById = new Map(existing.map((t) => [t.id, t]));
  const existingByName = new Map(existing.map((t) => [`${t.name.toLowerCase()}:${t.hats.join('+')}`, t]));

  console.log(`\n── Agent templates (${agents.size} distinct agents found) ──`);
  const keyToTemplate = new Map();
  let created = 0, skipped = 0;

  for (const [key, { id, agent, sources }] of agents) {
    const body = toTemplate(agent, ['imported', ...[...sources].filter((s) => s !== 'library')]);
    const nameKey = `${body.name.toLowerCase()}:${body.hats.join('+')}`;
    const already = (id && existingById.get(id)) || existingByName.get(nameKey);

    if (already) {
      keyToTemplate.set(key, already);
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  + ${body.name.padEnd(14)} ${body.hats.join('+').padEnd(18)} ${body.model.provider}`);
      keyToTemplate.set(key, { id: id ?? `dry-${key}`, revision: 1, ...body });
      created++;
      continue;
    }

    try {
      // PUT preserves the original id; POST would mint a new one.
      const saved = id
        ? await callApi('PUT', `${LIBRARY}/agent-templates/${encodeURIComponent(id)}`, body)
          .catch(() => callApi('POST', `${LIBRARY}/agent-templates`, { ...body, id }))
        : await callApi('POST', `${LIBRARY}/agent-templates`, body);
      keyToTemplate.set(key, saved);
      existingById.set(saved.id, saved);
      existingByName.set(nameKey, saved);
      created++;
      console.log(`  + ${saved.name.padEnd(14)} ${saved.hats.join('+').padEnd(18)} ${saved.model.provider}`);
    } catch (err) {
      console.error(`  ! ${body.name}: ${err.message}`);
    }
  }
  console.log(`  ${created} created, ${skipped} already present`);

  // ── Projects ───────────────────────────────────────────────────────────────
  console.log(`\n── Projects (${projects.length} folders found) ──`);
  const existingProjects = DRY_RUN
    ? new Set()
    : new Set((await callApi('GET', `${PROJECTS}/projects`)).projects.map((p) => p.id));

  let madeProjects = 0, skippedProjects = 0;
  for (const project of projects) {
    if (!project.hasState) { console.log(`  · ${project.dir} — no team-state.json, skipped`); continue; }
    if (!PROJECT_ID.test(project.dir)) {
      console.log(`  ! ${project.dir} — folder name is not a valid project id, skipped`);
      continue;
    }
    if (existingProjects.has(project.dir)) { console.log(`  · ${project.dir} — already present`); skippedProjects++; continue; }

    const team = [];
    for (const member of project.members) {
      const template = keyToTemplate.get(member.templateKey);
      if (!template) continue;
      // The Project Server rejects two agents sharing a name on one team.
      if (team.some((a) => a.name.toLowerCase() === member.agent.identity.name.trim().toLowerCase())) continue;
      team.push(toDeployedAgent(member.agent, member.instanceId, template));
    }

    const body = clean({
      id: project.dir,
      name: project.dir,
      goal: project.goal,
      humanName: project.humanName,
      team,
      mcpServers: project.mcpServers.filter((m) => m?.name && m?.config?.transport),
    });

    const note = project.unresolved.length ? ` (${project.unresolved.length} unresolved)` : '';
    if (DRY_RUN) {
      console.log(`  + ${project.dir.padEnd(14)} ${team.length} agents${note}: ${team.map((a) => a.name).join(', ')}`);
      madeProjects++;
      continue;
    }

    try {
      await callApi('POST', `${PROJECTS}/projects`, body);
      madeProjects++;
      console.log(`  + ${project.dir.padEnd(14)} ${team.length} agents${note}: ${team.map((a) => a.name).join(', ')}`);
    } catch (err) {
      console.error(`  ! ${project.dir}: ${err.message}`);
    }
  }
  console.log(`  ${madeProjects} created, ${skippedProjects} already present`);

  console.log('\nDone.');
  if (!DRY_RUN) console.log('Set the active project in the Project Designer, then start the runner.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
