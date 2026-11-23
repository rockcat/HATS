/** HATS Project Designer — compose a team from library templates. */

import {
  $, clear, debounce, el, guard, hatDots, makeClient, relativeTime, toastOk, trackHealth,
} from '/ui-kit/hats-ui.js';
import { openAgentDialog, setProviderCatalogue } from '/agent-dialog.js';
import {
  enabledIds, loadTeamMcpCatalogue, renderTeamMcp, selected as selectedTeamServers, teamMcpCatalogue,
} from '/team-mcp.js';
import { readVisitPolicy, renderVisitPolicy } from '/visit-policy.js';

const library = makeClient('/proxy/library/api/v1');
const projects = makeClient('/proxy/projects/api/v1');

const state = {
  projects: [],
  current: null,      // full ProjectDefinition being edited
  templates: [],
  dirty: false,
  dashboardUrl: null, // a runner's dashboard, when the server names one
};

const ui = {
  projectList:   $('#project-list'),
  projectEmpty:  $('#project-empty'),
  form:          $('#project-form'),
  designEmpty:   $('#design-empty'),
  designTitle:   $('#design-title'),
  revision:      $('#design-revision'),
  save:          $('#save-project'),
  del:           $('#delete-project'),
  openRunner:    $('#open-runner'),
  mcpSection:    $('#mcp-section'),
  visitsSection: $('#visits-section'),
  visitPolicy:   $('#visit-policy'),
  teamSection:   $('#team-section'),
  teamList:      $('#team-list'),
  teamEmpty:     $('#team-empty'),
  teamCount:     $('#team-count'),
  libraryList:   $('#library-list'),
  libraryEmpty:  $('#library-empty'),
  librarySearch: $('#library-search'),
};

// ── Loading ──────────────────────────────────────────────────────────────────

async function loadProjects() {
  const result = await projects.get('/projects');
  state.projects = result?.projects ?? [];
  renderProjectList();
}

async function loadTemplates() {
  const query = ui.librarySearch.value.trim();
  const result = await library.get(`/agent-templates${query ? `?q=${encodeURIComponent(query)}` : ''}`);
  state.templates = result?.templates ?? [];
  renderLibrary();
}

async function openProject(id) {
  if (state.dirty && !confirm('Discard unsaved changes?')) return;
  await guard(async () => {
    state.current = await projects.get(`/projects/${id}`);
    renderProject();
    renderProjectList();
  });
}

// ── Rendering ────────────────────────────────────────────────────────────────

function renderProjectList() {
  ui.projectEmpty.hidden = state.projects.length > 0;
  clear(ui.projectList);
  for (const project of state.projects.sort((a, b) => a.name.localeCompare(b.name))) {
    ui.projectList.append(el('li', {
      'aria-selected': project.id === state.current?.id,
      onclick: () => void openProject(project.id),
    },
      el('span', { class: 'grow' },
        el('div', { class: 'name' }, project.name),
        el('div', { class: 'meta' }, `${project.teamSize} agent${project.teamSize === 1 ? '' : 's'} · ${relativeTime(project.updatedAt)}`),
      ),
    ));
  }
}

function renderProject() {
  const project = state.current;
  ui.designEmpty.hidden = true;
  ui.form.hidden = false;
  ui.teamSection.hidden = false;
  renderTeamMcp(project, () => setDirty(true));
  ui.visitsSection.hidden = false;
  renderVisitPolicy(ui.visitPolicy, project, state.projects, () => setDirty(true));

  ui.form.elements['name'].value = project.name ?? '';
  ui.form.elements['humanName'].value = project.humanName ?? '';
  ui.form.elements['goal'].value = project.goal ?? '';
  ui.form.elements['description'].value = project.description ?? '';

  ui.designTitle.textContent = project.name;
  ui.revision.hidden = false;
  ui.revision.textContent = `rev ${project.revision}`;
  ui.del.disabled = false;
  ui.openRunner.disabled = false;
  setDirty(false);
  renderTeam();
}

function renderTeam() {
  const team = state.current?.team ?? [];
  ui.teamCount.textContent = String(team.length);
  ui.teamEmpty.hidden = team.length > 0;
  clear(ui.teamList);

  for (const agent of team) {
    const template = state.templates.find((t) => t.id === agent.templateId);
    const drifted = template && agent.templateRevision !== undefined && template.revision > agent.templateRevision;

    ui.teamList.append(el('li', { class: agent.enabled ? '' : 'disabled-agent' },
      el('span', { class: 'hats' }, ...hatDots(agent.hats)),
      el('span', { class: 'grow' },
        el('div', { class: 'name' }, agent.name),
        el('div', { class: 'meta' },
          [agent.projectRole, agent.identity?.specialisation, agent.model?.model].filter(Boolean).join(' · ')),
      ),
      drifted ? el('span', { class: 'drift', title: `Library template is at revision ${template.revision}` }, 'drift') : null,
      el('span', { class: 'actions' },
        drifted ? el('button', { class: 'small', onclick: () => void resync(agent) }, 'Resync') : null,
        el('button', { class: 'small', onclick: () => void editAgent(agent) }, 'Edit'),
        el('button', { class: 'small danger', onclick: () => void removeAgent(agent) }, 'Remove'),
      ),
    ));
  }
}

function renderLibrary() {
  ui.libraryEmpty.hidden = state.templates.length > 0;
  clear(ui.libraryList);
  for (const template of state.templates.sort((a, b) => a.name.localeCompare(b.name))) {
    const deployed = (state.current?.team ?? []).some((a) => a.templateId === template.id);
    ui.libraryList.append(el('li', {},
      el('span', { class: 'hats' }, ...hatDots(template.hats)),
      el('span', { class: 'grow' },
        el('div', { class: 'name' }, template.name),
        el('div', { class: 'meta' }, template.identity?.specialisation ?? template.description ?? ''),
      ),
      el('button', {
        class: 'small primary',
        disabled: !state.current,
        title: deployed ? 'Already deployed — a second copy needs a different name' : 'Deploy into this project',
        onclick: () => void deploy(template),
      }, deployed ? '+ again' : 'Deploy'),
    ));
  }
}

function setDirty(dirty) {
  state.dirty = dirty;
  ui.save.disabled = !dirty || !state.current;
  const base = state.current?.name ?? 'Select a project';
  ui.designTitle.replaceChildren(base, ...(dirty ? [el('span', { class: 'dirty-marker' }, ' •')] : []));
}

// ── Actions ──────────────────────────────────────────────────────────────────

async function createProject() {
  const name = prompt('Project name');
  if (!name?.trim()) return;
  await guard(async () => {
    const created = await projects.post('/projects', { name: name.trim() });
    await loadProjects();
    state.current = created;
    renderProject();
    renderLibrary();
    renderProjectList();
  }, 'Project created');
}

async function saveProject() {
  if (!state.current) return;
  const form = ui.form.elements;
  await guard(async () => {
    const updated = await projects.patch(`/projects/${state.current.id}`, {
      name: form['name'].value.trim(),
      humanName: form['humanName'].value.trim() || 'Human',
      goal: form['goal'].value.trim(),
      description: form['description'].value.trim(),
      // Catalogue ids; the Project Server expands them into definitions.
      mcpServerIds: selectedTeamServers(),
      // Settings are replaced whole, so the ones this form does not show go back as they were.
      settings: readVisitPolicy(ui.visitPolicy, state.current.settings),
      expectedRevision: state.current.revision,
    });
    state.current = updated;
    await loadProjects();
    renderProject();
  }, 'Saved');
}

async function deleteProject() {
  if (!state.current) return;
  const name = state.current.name;
  if (!confirm(`Delete "${name}"? The project definition is removed; its working folder is left on disk.`)) return;
  await guard(async () => {
    await projects.delete(`/projects/${state.current.id}`);
    state.current = null;
    state.dirty = false;
    ui.form.hidden = true;
    ui.teamSection.hidden = true;
    ui.mcpSection.hidden = true;
    ui.visitsSection.hidden = true;
    ui.designEmpty.hidden = false;
    ui.revision.hidden = true;
    ui.designTitle.textContent = 'Select a project';
    ui.del.disabled = ui.openRunner.disabled = ui.save.disabled = true;
    await loadProjects();
    renderLibrary();
  }, `Deleted ${name}`);
}

/**
 * Open this project's runner in a new tab. The link goes to a runner's
 * dashboard, which signs the user in and then opens the project's own runner,
 * or starts one for an admin, exactly as its project badge does.
 */
function openRunner() {
  if (!state.current) return;
  if (state.dirty && !confirm('This project has unsaved changes, which its runner will not see until they are saved. Open it anyway?')) return;
  const dashboard = state.dashboardUrl ?? `${location.protocol}//${location.hostname}:3001`;
  window.open(`${dashboard}/?open=${encodeURIComponent(state.current.id)}`, '_blank', 'noopener');
}

async function deploy(template) {
  if (!state.current) return;
  const existing = (state.current.team ?? []).filter((a) => a.templateId === template.id).length;
  const name = existing > 0 ? `${template.name} ${existing + 1}` : template.name;
  await guard(async () => {
    await projects.post(`/projects/${state.current.id}/team`, { templateId: template.id, name });
    await reloadCurrent();
  }, `Deployed ${name}`);
}

async function removeAgent(agent) {
  if (!confirm(`Remove ${agent.name} from this project?`)) return;
  await guard(async () => {
    await projects.delete(`/projects/${state.current.id}/team/${agent.instanceId}`);
    await reloadCurrent();
  }, `Removed ${agent.name}`);
}

async function editAgent(agent) {
  const ids = new Set(enabledIds(state.current));
  const patch = await openAgentDialog(agent, teamMcpCatalogue().filter((s) => ids.has(s.id)), teamMcpCatalogue());
  if (!patch) return;
  await guard(async () => {
    await projects.patch(`/projects/${state.current.id}/team/${agent.instanceId}`, patch);
    await reloadCurrent();
  }, `Updated ${agent.name}`);
}

/** Pull the latest template values over a deployed agent that has drifted. */
async function resync(agent) {
  const template = state.templates.find((t) => t.id === agent.templateId);
  if (!template) return;
  if (!confirm(`Re-apply "${template.name}" revision ${template.revision} over ${agent.name}? Project-local edits to identity, hats and model are overwritten.`)) return;
  await guard(async () => {
    await projects.patch(`/projects/${state.current.id}/team/${agent.instanceId}`, {
      hats: template.hats,
      identity: template.identity,
      model: template.model,
      limits: template.limits,
      tools: template.tools,
      scheduledActionIds: template.scheduledActionIds,
      templateRevision: template.revision,
    });
    await reloadCurrent();
  }, `${agent.name} resynced`);
}

async function reloadCurrent() {
  state.current = await projects.get(`/projects/${state.current.id}`);
  renderProject();
  renderLibrary();
  await loadProjects();
}

// ── Wiring ───────────────────────────────────────────────────────────────────

async function init() {
  ui.form.addEventListener('input', () => setDirty(true));
  ui.form.addEventListener('submit', (event) => { event.preventDefault(); void saveProject(); });
  ui.save.addEventListener('click', () => void saveProject());
  ui.del.addEventListener('click', () => void deleteProject());
  ui.openRunner.addEventListener('click', openRunner);
  $('#new-project').addEventListener('click', () => void createProject());
  ui.librarySearch.addEventListener('input', debounce(() => void loadTemplates(), 250));

  window.addEventListener('beforeunload', (event) => { if (state.dirty) event.preventDefault(); });

  trackHealth($('#library-dot'), null, '/proxy/library/api/v1/health');
  trackHealth($('#server-dot'), null, '/proxy/projects/api/v1/health');

  const config = await guard(() => fetch('/api/v1/config').then((r) => r.json()));
  if (config?.agentLibraryUrl) $('#library-link').href = config.agentLibraryUrl;
  if (config?.dashboardUrl) state.dashboardUrl = config.dashboardUrl.replace(/\/$/, '');

  await guard(async () => {
    const providers = await library.get('/providers');
    setProviderCatalogue(providers?.providers ?? []);
    await loadTeamMcpCatalogue(projects);
    await loadTemplates();
    await loadProjects();
    if (state.projects[0]) await openProject(state.projects[0].id);
  });
}

await init();
