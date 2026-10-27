/** HATS Agent Template Library — template browser, editor and live preview. */

import {
  $, $$, clear, debounce, el, guard, hatDots, makeClient, relativeTime, toastError, toastOk, trackHealth,
} from '/ui-kit/hats-ui.js';
import {
  applyPersona, buildHatCheckboxes, buildServerPicker, emptyTemplate, readForm,
  selectedServers, writeForm,
} from '/template-form.js';
import { clearAvatar, showAvatar } from '/ui-kit/avatar-stage.js';
import { configuredPersonalServers, loadMcpCatalogue, showMcpFor } from '/mcp-panel.js';
import { readUpfront, setToolSources, syncMode, writeUpfront } from '/upfront-tools.js';
import { renderToolPreview } from '/tool-preview.js';
import { initVoicePicker, initVoices } from '/voice-picker.js';

const api = makeClient('/api/v1');

const state = {
  templates: [],
  selectedId: null,
  personas: {},
  providers: [],
  avatars: [],
  mcp: { personal: [], shared: [] },
  /** Catalogue entries this agent can draw tools from. */
  toolSources: [],
  dirty: false,
  // What the stage is currently showing, so an unrelated keystroke does not
  // trigger a multi-megabyte model reload.
  shownAvatar: null,
  shownBackground: null,
};

const ui = {
  list:        $('#template-list'),
  empty:       $('#template-empty'),
  count:       $('#template-count'),
  search:      $('#search'),
  hatFilter:   $('#hat-filter'),
  form:        $('#editor-form'),
  editorEmpty: $('#editor-empty'),
  title:       $('#editor-title'),
  revision:    $('#editor-revision'),
  save:        $('#save-template'),
  del:         $('#delete-template'),
  duplicate:   $('#duplicate-template'),
  newBtn:      $('#new-template'),
  promptText:  $('#prompt-text'),
  promptLen:   $('#prompt-length'),
  canvas:      $('#avatar-canvas'),
  background:  $('#stage-background'),
  stageHint:   $('#stage-hint'),
};

// ── Loading ──────────────────────────────────────────────────────────────────

async function loadCatalogue() {
  const [personas, providers, avatars, backgrounds, specialisations, hats, voices] = await Promise.all([
    api.get('/personas'), api.get('/providers'), api.get('/avatars'),
    api.get('/backgrounds'), api.get('/specialisations'), api.get('/hats'),
    api.get('/voices'),
  ]);

  state.personas = personas ?? {};
  state.providers = providers?.providers ?? [];
  initVoices(ui.form, voices?.voices ?? []);
  state.avatars = avatars?.avatars ?? [];

  const providerSelect = ui.form.elements['provider'];
  providerSelect.replaceChildren(...state.providers.map((p) =>
    el('option', { value: p.name }, p.configured ? p.label : `${p.label} (no key)`)));
  providerSelect.addEventListener('change', refreshModelOptions);
  refreshModelOptions();

  $('#specialisation-options').replaceChildren(
    ...(specialisations?.specialisations ?? []).map((s) => el('option', { value: s })));

  ui.form.elements['avatar'].replaceChildren(
    el('option', { value: '' }, '—'),
    ...state.avatars.map((a) => el('option', { value: a.file }, a.name ?? a.file)));

  ui.form.elements['background'].replaceChildren(
    el('option', { value: '' }, '—'),
    ...(backgrounds?.backgrounds ?? []).map((f) => el('option', { value: f }, f.replace(/\.\w+$/, ''))));

  ui.hatFilter.replaceChildren(
    el('option', { value: '' }, 'All hats'),
    ...(hats?.hats ?? []).map((h) => el('option', { value: h.type }, h.label ?? h.type)));

  const options = [el('option', { value: '' }, '—')];
  for (const [hat, list] of Object.entries(state.personas)) {
    if (!list?.length) continue;
    const group = el('optgroup', { label: `${hat} hat` });
    for (const persona of list) group.append(el('option', { value: `${hat}:${persona.name}` }, persona.name));
    options.push(group);
  }
  ui.form.elements['persona'].replaceChildren(...options);
}

function refreshModelOptions() {
  const provider = state.providers.find((p) => p.name === ui.form.elements['provider'].value);
  $('#model-options').replaceChildren(...(provider?.models ?? []).map((m) => el('option', { value: m })));
}

async function loadTemplates() {
  const params = new URLSearchParams();
  if (ui.search.value.trim()) params.set('q', ui.search.value.trim());
  if (ui.hatFilter.value) params.set('hat', ui.hatFilter.value);
  const result = await api.get(`/agent-templates${params.toString() ? `?${params}` : ''}`);
  state.templates = result?.templates ?? [];
  renderList();
}

// ── Rendering ────────────────────────────────────────────────────────────────

function renderList() {
  ui.count.textContent = String(state.templates.length);
  ui.empty.hidden = state.templates.length > 0;
  clear(ui.list);

  for (const template of state.templates.sort((a, b) => a.name.localeCompare(b.name))) {
    // An avatar that is no longer in the catalogue would just render as an
    // empty stage, so flag it here where it can be found and fixed.
    const avatar = template.identity?.avatar;
    const missingAvatar = avatar && !state.avatars.some((a) => a.file === avatar);

    ui.list.append(el('li', {
      dataset: { id: template.id },
      'aria-selected': template.id === state.selectedId,
      onclick: () => selectTemplate(template.id),
    },
      el('span', { class: 'hats' }, ...hatDots(template.hats)),
      el('span', { class: 'grow' },
        el('div', { class: 'name' }, template.name),
        el('div', { class: 'meta' },
          [template.identity?.specialisation, template.description].filter(Boolean).join(' · ') || 'no description'),
      ),
      missingAvatar
        ? el('span', { class: 'tag warn', title: `Avatar "${avatar}" is missing — pick another` }, 'no avatar')
        : el('span', { class: 'meta' }, relativeTime(template.updatedAt)),
    ));
  }
}

function renderEditor(template, { isNew = false } = {}) {
  ui.editorEmpty.hidden = true;
  ui.form.hidden = false;
  writeForm(ui.form, template);
  setTitle(isNew ? 'New template' : template.name);
  ui.revision.hidden = isNew;
  ui.revision.textContent = isNew ? '' : `rev ${template.revision}`;
  ui.del.disabled = isNew;
  ui.duplicate.disabled = isNew;
  setDirty(isNew);
  // Switching template always repaints the stage, even onto the same filename.
  refreshPreview({ force: true });
}

function setTitle(text) {
  ui.title.dataset.base = text;
  ui.title.replaceChildren(text, ...(state.dirty ? [el('span', { class: 'dirty-marker' }, ' •')] : []));
}

function setDirty(dirty) {
  state.dirty = dirty;
  ui.save.disabled = !dirty;
  setTitle(ui.title.dataset.base ?? 'Select a template');
}

// ── Live preview ─────────────────────────────────────────────────────────────

/** Re-render prompt and stage from whatever is currently in the form. */
function refreshPreview({ force = false } = {}) {
  if (ui.form.hidden) return;
  renderStage(force);
  void renderPrompt();
}

const renderPrompt = debounce(async () => {
  if (ui.form.hidden) return;
  try {
    const result = await api.post('/prompt-preview', readForm(ui.form));
    ui.promptText.textContent = result.prompt;
    ui.promptLen.textContent = `${result.prompt.length.toLocaleString()} chars`;
  } catch (err) {
    ui.promptText.textContent = `Could not render the prompt: ${err.message}`;
    ui.promptLen.textContent = '';
  }
}, 200);

/**
 * Repaint the stage, but only touch the renderer when the selection actually
 * changed. An avatar is a 4–18 MB GLB or VRM, so reloading it on every
 * keystroke in an unrelated field would be ruinous.
 *
 * Pass `force` after switching template, where the same filename may need
 * re-rendering onto a freshly cleared stage.
 */
function renderStage(force = false) {
  const backgroundFile = ui.form.elements['background'].value;
  if (force || backgroundFile !== state.shownBackground) {
    state.shownBackground = backgroundFile;
    ui.background.hidden = !backgroundFile;
    if (backgroundFile) ui.background.src = `/backgrounds/${encodeURIComponent(backgroundFile)}`;
  }

  const avatarFile = ui.form.elements['avatar'].value;
  if (!force && avatarFile === state.shownAvatar) return;
  state.shownAvatar = avatarFile;

  const entry = state.avatars.find((a) => a.file === avatarFile);

  if (!entry) {
    clearAvatar();
    ui.canvas.hidden = true;
    ui.stageHint.hidden = false;
    ui.stageHint.textContent = avatarFile ? `${avatarFile} is not in the catalogue` : 'No avatar selected';
    return;
  }

  ui.canvas.hidden = false;
  ui.stageHint.hidden = true;
  showAvatar(ui.canvas, { ...entry, url: `/avatars/${encodeURIComponent(entry.file)}` }).catch((err) => {
    ui.canvas.hidden = true;
    ui.stageHint.hidden = false;
    ui.stageHint.textContent = `Could not load ${entry.file}: ${err.message}`;
  });
}

// ── Actions ──────────────────────────────────────────────────────────────────

function selectTemplate(id) {
  if (state.dirty && !confirm('Discard unsaved changes?')) return;
  const template = state.templates.find((t) => t.id === id);
  if (!template) return;
  state.selectedId = id;
  renderEditor(template);
  renderList();
  // MCP credentials key off the saved template, not the form. The upfront
  // picker can only be built once we know which servers this agent has.
  void showMcpFor(id).then(() => refreshToolSources());
}

/**
 * Rebuild the "tools sent to the model" picker from what this agent can
 * currently reach: its own configured servers, plus the team servers its
 * allow-list lets through.
 */
function refreshToolSources() {
  const useAll = ui.form.elements['allMcpServers']?.checked ?? true;
  const sources = setToolSources(
    state.mcp, configuredPersonalServers(), useAll ? undefined : selectedServers(ui.form));
  writeUpfront(ui.form, readUpfront(ui.form));
  state.toolSources = sources;
  refreshToolPreview();
}

/** What the agent will actually be handed, and what it must search for. */
function refreshToolPreview() {
  void renderToolPreview(state.toolSources ?? [], readUpfront(ui.form), readForm(ui.form).hats);
}

function startNewTemplate() {
  if (state.dirty && !confirm('Discard unsaved changes?')) return;
  const defaultProvider = state.providers.find((p) => p.configured) ?? state.providers[0];
  state.selectedId = null;
  renderEditor(emptyTemplate(defaultProvider
    ? { provider: defaultProvider.name, model: defaultProvider.models?.[0] ?? '' }
    : undefined), { isNew: true });
  renderList();
  // Neither panel applies until the template exists on the server.
  void showMcpFor(null).then(() => refreshToolSources());
  ui.form.elements['name'].focus();
  ui.form.elements['name'].select();
}

async function save() {
  const input = readForm(ui.form);
  if (!input.name) { ui.form.elements['name'].focus(); return; }

  await guard(async () => {
    const saved = state.selectedId
      ? await api.put(`/agent-templates/${state.selectedId}`, input)
      : await api.post('/agent-templates', input);
    const isNew = !state.selectedId;
    state.selectedId = saved.id;
    await loadTemplates();
    renderEditor(saved);
    // A brand new template can now take MCP credentials.
    if (isNew) { void showMcpFor(saved.id); }
    toastOk(`Saved ${saved.name}`);
  });
}

async function remove() {
  const template = state.templates.find((t) => t.id === state.selectedId);
  if (!template || !confirm(`Delete "${template.name}" from the library?`)) return;
  await guard(async () => {
    await api.delete(`/agent-templates/${template.id}`);
    state.selectedId = null;
    setDirty(false);
    ui.form.hidden = true;
    ui.editorEmpty.hidden = false;
    setTitle('Select a template');
    ui.revision.hidden = true;
    ui.del.disabled = ui.duplicate.disabled = true;
    ui.promptText.textContent = 'Select a template to see the system prompt it produces.';
    ui.promptLen.textContent = '';
    clearAvatar();
    state.shownAvatar = null;
    state.shownBackground = null;
    ui.canvas.hidden = true;
    ui.background.hidden = true;
    ui.stageHint.hidden = false;
    ui.stageHint.textContent = 'No avatar selected';
    void showMcpFor(null);
    await loadTemplates();
  }, `Deleted ${template.name}`);
}

async function duplicate() {
  if (!state.selectedId) return;
  await guard(async () => {
    const copy = await api.post(`/agent-templates/${state.selectedId}/duplicate`, {});
    await loadTemplates();
    state.selectedId = copy.id;
    renderEditor(copy);
    renderList();
    // Credentials are per-agent and are deliberately not copied.
    void showMcpFor(copy.id);
  }, 'Duplicated');
}

function onPersonaChange(event) {
  const [hat, name] = (event.target.value || '').split(':');
  const persona = (state.personas[hat] ?? []).find((p) => p.name === name);
  if (!persona) return;
  applyPersona(ui.form, persona);
  for (const box of ui.form.querySelectorAll('input[name="hats"]')) box.checked = box.value === hat;
  setDirty(true);
  refreshPreview();
}

// ── Wiring ───────────────────────────────────────────────────────────────────

function init() {
  buildHatCheckboxes($('#hat-checkboxes'));

  ui.form.addEventListener('input', (event) => {
    if (event.target.name === 'persona') return;
    setDirty(true);
    refreshPreview();
  });
  ui.form.addEventListener('change', (event) => {
    if (event.target.name === 'persona') { onPersonaChange(event); return; }
    // Showing the picker only when an explicit allow-list is in play keeps the
    // "every server" default from looking like "no servers".
    if (event.target.name === 'allMcpServers') {
      $('#shared-mcp-list').hidden = event.target.checked;
    }
    if (event.target.name === 'upfrontMode') syncMode(ui.form);
    // Changing which servers the agent may use changes what it can be given.
    if (['allMcpServers', 'mcpServer'].includes(event.target.name)) refreshToolSources();
    // The hats decide the runner's core tools, so they change the list too.
    if (['upfrontMode', 'upfrontServer', 'upfrontTool', 'hats'].includes(event.target.name)) refreshToolPreview();
    setDirty(true);
    refreshPreview();
  });
  ui.form.addEventListener('submit', (event) => { event.preventDefault(); void save(); });

  ui.save.addEventListener('click', () => void save());
  ui.del.addEventListener('click', () => void remove());
  ui.duplicate.addEventListener('click', () => void duplicate());
  ui.newBtn.addEventListener('click', startNewTemplate);

  const reload = debounce(() => void loadTemplates(), 250);
  ui.search.addEventListener('input', reload);
  ui.hatFilter.addEventListener('change', () => void loadTemplates());

  window.addEventListener('beforeunload', (event) => { if (state.dirty) event.preventDefault(); });


  // The panel shows one view at a time: the prompt, or the tools behind it.
  $('#preview-tabs').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    const tools = button.dataset.view === 'tools';
    for (const b of $$('#preview-tabs button')) b.classList.toggle('active', b === button);
    $('#prompt-scroll').hidden = tools;
    $('#tool-preview').hidden = !tools;
    if (tools) refreshToolPreview();
  });

  initVoicePicker(ui.form);
  trackHealth($('#health-dot'), $('#health-label'), '/api/v1/health');
}

init();
try {
  await loadCatalogue();
  const mcp = await loadMcpCatalogue();
  state.mcp = mcp;
  buildServerPicker($('#shared-mcp-list'), mcp.shared ?? []);
  await loadTemplates();
  const first = state.templates[0];
  if (first) selectTemplate(first.id);
} catch (err) {
  toastError(err);
}
