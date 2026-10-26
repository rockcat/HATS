// ── Managing voices ───────────────────────────────────────────────────────────
//
// Wiring only; the shaping is in voices-model.js. Installing downloads a
// model of tens of megabytes and starts a Piper server for it, so it takes a
// while — the row says so rather than the page going quiet.

import { $, clear, el, guard, makeClient, toastOk, trackHealth } from '/ui-kit/hats-ui.js';
import {
  describeInstalled, filterAvailable, formatSize, languagesOf, preferredLanguage,
} from '/voices-model.js';

const speech = makeClient('/api/v1');

const state = {
  running: [],
  catalogue: [],
  catalogueError: '',
  installing: new Set(),
  playing: null,
  /** Speaker picked per multi-speaker voice, kept across re-renders. */
  speaker: new Map(),
};

// ── Loading ──────────────────────────────────────────────────────────────────

async function load() {
  const [running, catalogue] = await Promise.allSettled([
    speech.get('/voices'),
    speech.get('/voices/catalogue'),
  ]);
  state.running = running.status === 'fulfilled' ? running.value.voices : [];
  if (catalogue.status === 'fulfilled') {
    state.catalogue = catalogue.value.voices;
    state.catalogueError = '';
  } else {
    state.catalogueError = catalogue.reason?.message ?? 'The voice catalogue could not be fetched';
  }
  render();
}

// ── Rendering ────────────────────────────────────────────────────────────────

function render() {
  renderInstalled();
  renderAvailable();
}

function details(v) {
  return [
    v.language && `${v.language} (${v.country})`,
    v.quality,
    v.speakerCount > 1 || v.speakers > 1 ? `${v.speakerCount ?? v.speakers} speakers` : '',
    formatSize(v.sizeBytes),
  ].filter(Boolean).join(' · ');
}

function renderInstalled() {
  const list = $('#installed');
  clear(list);
  const rows = describeInstalled(state.running, state.catalogue);
  $('#installed-count').textContent = rows.length ? `${rows.length}` : '';

  if (rows.length === 0) {
    list.append(el('li', { class: 'empty' }, 'No voices yet. Add one, and agents can speak.'));
    return;
  }
  for (const v of rows) {
    list.append(el('li', { class: 'voice' },
      el('div', { class: 'voice-text' },
        el('span', { class: 'mono name' }, v.name),
        el('span', { class: 'muted' }, details(v) || 'Not in the Piper catalogue'),
        v.running ? '' : el('span', { class: 'tag warn' }, 'not running'),
      ),
      v.speakerNames.length > 1 ? speakerPicker(v) : '',
      el('button', {
        class: 'small', disabled: !v.running, title: v.running ? 'Play the sample' : 'This voice has not started',
        onclick: (e) => play(v.name, e.currentTarget),
      }, state.playing === v.name ? 'Playing…' : 'Play'),
      el('button', { class: 'small danger', onclick: () => remove(v.name) }, 'Remove'),
    ));
  }
}

/** Which of a multi-speaker voice's speakers the sample uses. */
function speakerPicker(v) {
  if (!state.speaker.has(v.name)) state.speaker.set(v.name, v.defaultSpeaker || v.speakerNames[0]);
  const select = el('select', {
    class: 'speaker', title: 'Speaker',
    onchange: (e) => state.speaker.set(v.name, e.currentTarget.value),
  }, ...v.speakerNames.map((s) => el('option', { value: s }, s === v.defaultSpeaker ? `${s} (default)` : s)));
  select.value = state.speaker.get(v.name);
  return select;
}

function renderAvailable() {
  const list = $('#available');
  clear(list);
  if (state.catalogueError) {
    $('#available-count').textContent = '';
    list.append(el('li', { class: 'empty' }, state.catalogueError));
    return;
  }

  const shown = filterAvailable(state.catalogue, {
    query: $('#filter-query').value,
    language: $('#filter-language').value,
    quality: $('#filter-quality').value,
  });
  $('#available-count').textContent = `${shown.length} of ${state.catalogue.filter((v) => !v.installed).length}`;

  if (shown.length === 0) {
    list.append(el('li', { class: 'empty' }, 'Nothing matches.'));
    return;
  }
  for (const v of shown) {
    const busy = state.installing.has(v.name);
    list.append(el('li', { class: 'voice' },
      el('div', { class: 'voice-text' },
        el('span', { class: 'mono name' }, v.name),
        el('span', { class: 'muted' }, details(v)),
      ),
      el('button', { class: 'small primary', disabled: busy, onclick: () => install(v.name) },
        busy ? 'Installing…' : 'Install'),
    ));
  }
}

function fillLanguages() {
  const select = $('#filter-language');
  const languages = languagesOf(state.catalogue);
  for (const { code, label } of languages) select.append(el('option', { value: code }, label));
  select.value = preferredLanguage(languages, navigator.language);
}

// ── Actions ──────────────────────────────────────────────────────────────────

async function install(name) {
  state.installing.add(name);
  renderAvailable();
  await guard(() => speech.post('/voices/install', { name }), `${name} installed`);
  state.installing.delete(name);
  await load();
}

async function remove(name) {
  if (!confirm(`Remove ${name}? Agents using it will fall back to another voice.`)) return;
  await guard(() => speech.delete(`/voices/${encodeURIComponent(name)}`), `${name} removed`);
  await load();
}

async function play(name, button) {
  button.disabled = true;
  state.playing = name;
  button.textContent = 'Playing…';
  await guard(async () => {
    const res = await fetch('/api/v1/speech/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voice: name, speakerName: state.speaker.get(name), text: $('#sample-text').value }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
    const audio = new Audio(URL.createObjectURL(await res.blob()));
    await audio.play();
    await new Promise((resolve) => { audio.onended = resolve; audio.onerror = resolve; });
  });
  state.playing = null;
  renderInstalled();
}

// ── Start ────────────────────────────────────────────────────────────────────

for (const id of ['#filter-query', '#filter-language', '#filter-quality']) {
  $(id).addEventListener('input', renderAvailable);
}
trackHealth($('#health-dot'), $('#health-label'), '/api/v1/health');

await load();
fillLanguages();
renderAvailable();
if (state.catalogue.length) toastOk(`${state.catalogue.length} voices in the Piper catalogue`);
