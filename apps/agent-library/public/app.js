/** HATS Agent Library — template browser and editor. */

import {
  $, clear, debounce, el, guard, hatDots, makeClient, relativeTime, toastOk, trackHealth,
} from '/ui-kit/hats-ui.js';
import { applyPersona, buildHatCheckboxes, emptyTemplate, readForm, writeForm } from '/template-form.js';

const api = makeClient('/api/v1');

const state = {
  templates: [],
  selectedId: null,
  draft: null,        // set while editing an unsaved new template
  personas: {},
  providers: [],
  dirty: false,
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
  preview:     $('#preview-prompt'),
  newBtn:      $('#new-template'),
  dialog:      $('#prompt-dialog'),
  promptText:  $('#prompt-text'),
};

// ── Loading ──────────────────────────────────────────────────────────────────

async function loadCatalogue() {
  const [personas, providers, avatars, specialisations, hats] = await Promise.all([
    api.get('/personas'), api.get('/providers'), api.get('/avatars'),
    api.get('/specialisations'), api.get('/hats'),
  ]);

  state.personas = personas ?? {};
  state.providers = providers?.providers ?? [];

  const providerSelect = ui.form.elements['provider'];
  providerSelect.replaceChildren(...state.providers.map((p) =>
    el('option', { value: p.name }, p.configured ? p.label : `${p.label} (no key)`)));
  providerSelect.addEventListener('change', refreshModelOptions);
  refreshModelOptions();

  $('#specialisation-options').replaceChildren(
    ...(specialisations?.specialisations ?? []).map((s) => el('option', { value: s })));

  ui.form.elements['avatar'].replaceChildren(
    el('option', { value: '' }, '—'),
    ...(avatars?.avatars ?? []).map((a) => el('option', { value: a.file }, a.name ?? a.file)));

  ui.hatFilter.replaceChildren(
    el('option', { value: '' }, 'All hats'),
    ...(hats?.hats ?? []).map((h) => el('option', { value: h.type }, h.label ?? h.type)));

  const personaSelect = ui.form.elements['persona'];
  const options = [el('option', { value: '' }, '—')];
  for (const [hat, list] of Object.entries(state.personas)) {
    if (!list?.length) continue;
    const group = el('optgroup', { label: `${hat} hat` });
    for (const persona of list) group.append(el('option', { value: `${hat}:${persona.name}` }, persona.name));
    options.push(group);
  }
  personaSelect.replaceChildren(...options);
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

  for (const template of state.templates) {
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
      el('span', { class: 'meta' }, relativeTime(template.updatedAt)),
    ));
  }
}

function renderEditor(template, { isNew = false } = {}) {
  ui.editorEmpty.hidden = true;
  ui.form.hidden = false;
  writeForm(ui.form, template);
  ui.title.textContent = isNew ? 'New template' : template.name;
  ui.revision.hidden = isNew;
  ui.revision.textContent = isNew ? '' : `rev ${template.revision}`;
  ui.del.disabled = isNew;
  ui.duplicate.disabled = isNew;
  ui.preview.disabled = isNew;
  setDirty(isNew);
}

function setDirty(dirty) {
  state.dirty = dirty;
  ui.save.disabled = !dirty;
  ui.title.textContent = ui.title.textContent.replace(/ •$/, '');
  if (dirty) ui.title.append(el('span', { class: 'dirty-marker' }, ' •'));
}

// ── Actions ──────────────────────────────────────────────────────────────────

function selectTemplate(id) {
  if (state.dirty && !confirm('Discard unsaved changes?')) return;
  const template = state.templates.find((t) => t.id === id);
  if (!template) return;
  state.selectedId = id;
  state.draft = null;
  renderEditor(template);
  renderList();
}

function startNewTemplate() {
  if (state.dirty && !confirm('Discard unsaved changes?')) return;
  const defaultProvider = state.providers.find((p) => p.configured) ?? state.providers[0];
  state.selectedId = null;
  state.draft = emptyTemplate(defaultProvider
    ? { provider: defaultProvider.name, model: defaultProvider.models?.[0] ?? '' }
    : undefined);
  renderEditor(state.draft, { isNew: true });
  renderList();
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
    state.selectedId = saved.id;
    state.draft = null;
    await loadTemplates();
    renderEditor(saved);
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
    ui.title.textContent = 'Select a template';
    ui.revision.hidden = true;
    ui.del.disabled = ui.duplicate.disabled = ui.preview.disabled = true;
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
  }, 'Duplicated');
}

async function previewPrompt() {
  if (!state.selectedId) return;
  await guard(async () => {
    const result = await api.get(`/agent-templates/${state.selectedId}/prompt-preview`);
    ui.promptText.textContent = result.prompt;
    ui.dialog.showModal();
  });
}

function onPersonaChange(event) {
  const [hat, name] = (event.target.value || '').split(':');
  const persona = (state.personas[hat] ?? []).find((p) => p.name === name);
  applyPersona(ui.form, persona);
  const checkbox = ui.form.querySelector(`input[name="hats"][value="${hat}"]`);
  if (checkbox) {
    for (const box of ui.form.querySelectorAll('input[name="hats"]')) box.checked = false;
    checkbox.checked = true;
  }
  setDirty(true);
}

// ── Wiring ───────────────────────────────────────────────────────────────────

function init() {
  buildHatCheckboxes($('#hat-checkboxes'));
  ui.form.addEventListener('input', (event) => {
    if (event.target.name !== 'persona') setDirty(true);
  });
  ui.form.addEventListener('change', (event) => {
    if (event.target.name === 'persona') onPersonaChange(event);
  });
  ui.form.addEventListener('submit', (event) => { event.preventDefault(); void save(); });

  ui.save.addEventListener('click', () => void save());
  ui.del.addEventListener('click', () => void remove());
  ui.duplicate.addEventListener('click', () => void duplicate());
  ui.preview.addEventListener('click', () => void previewPrompt());
  ui.newBtn.addEventListener('click', startNewTemplate);
  $('#close-prompt').addEventListener('click', () => ui.dialog.close());

  const reload = debounce(() => void loadTemplates(), 250);
  ui.search.addEventListener('input', reload);
  ui.hatFilter.addEventListener('change', () => void loadTemplates());

  window.addEventListener('beforeunload', (event) => {
    if (state.dirty) event.preventDefault();
  });

  trackHealth($('#health-dot'), $('#health-label'), '/api/v1/health');
}

init();
await guard(async () => {
  await loadCatalogue();
  await loadTemplates();
});
