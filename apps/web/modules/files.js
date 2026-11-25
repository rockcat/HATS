// ── Project Files: an explorer, with a preview on the right ─────────────────
//
// Folders to browse with breadcrumbs, as a list or as icons, and the selected
// file previewed beside them. A click selects and previews; a double-click,
// or Enter, opens a folder, or shows a file full-screen.
//
// Folders come from file-explorer-logic.js, previews from file-preview.js,
// and the toolbar's buttons from files-actions.js.

import { esc, fmtSize, fileIcon } from './utils.js';
import { fileUrl, dashboardLinkFor, copyWithFeedback } from './file-links.js';
import { buildIndex, folderContents, countIn, crumbs, existingFolder, kindOf, ROOT } from './file-explorer-logic.js';
import { renderPreview, canPreview, openFileViewer } from './file-preview.js';
import { initFilesActions } from './files-actions.js';

const MODE_KEY = 'filesViewMode';
const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i;

const view = {
  listing: { sources: [], outputs: [], tickets: [] },
  index: buildIndex(),
  folder: ROOT,
  selected: null,
  /** What the preview shows now, so a refresh does not reload it for nothing. */
  previewed: '',
  mode: readMode(),
};
let filesRefreshTimer = null;

function readMode() {
  try { return localStorage.getItem(MODE_KEY) === 'icons' ? 'icons' : 'list'; } catch { return 'list'; }
}

const $ = (id) => document.getElementById(id);
const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');

/** How many things a folder holds, in words. */
function itemCount(path) {
  const n = countIn(view.index, path);
  return n === 1 ? '1 item' : `${n} items`;
}

function iconFor(entry) {
  return entry.isDir ? '📁' : fileIcon(entry.name, false);
}

// ── Drawing ─────────────────────────────────────────────────────────────────

function drawCrumbs() {
  const el = $('files-crumbs');
  if (!el) return;
  const trail = crumbs(view.index, view.folder);
  el.innerHTML = trail.map((c, i) => i === trail.length - 1
    ? `<span class="files-crumb files-crumb--here" aria-current="page">${esc(c.label)}</span>`
    : `<button type="button" class="files-crumb" data-folder="${esc(c.path)}">${esc(c.label)}</button><span class="files-crumb-sep" aria-hidden="true">›</span>`).join('');
  const up = $('files-up');
  if (up) up.disabled = view.folder === ROOT;
}

function itemHtml(entry) {
  const selected = entry.path === view.selected ? ' files-item--selected' : '';
  const dir = entry.isDir ? ' files-item--dir' : '';
  const attrs = `class="files-item${dir}${selected}" data-path="${esc(entry.path)}" title="${esc(entry.label)}" aria-selected="${entry.path === view.selected}" role="option" tabindex="0"`;
  if (view.mode === 'icons') {
    const thumb = !entry.isDir && IMAGE.test(entry.name)
      ? `<img class="files-thumb" src="${esc(fileUrl(entry.path))}" alt="" loading="lazy">`
      : `<span class="files-big-icon" aria-hidden="true">${iconFor(entry)}</span>`;
    const sub = entry.isDir ? itemCount(entry.path) : fmtSize(entry.size);
    return `<div ${attrs}>${thumb}<span class="files-item-name">${esc(entry.label)}</span><span class="files-item-sub">${esc(sub)}</span></div>`;
  }
  return `<div ${attrs}>
    <span class="files-col-name"><span class="files-icon" aria-hidden="true">${iconFor(entry)}</span><span class="files-item-name">${esc(entry.label)}</span></span>
    <span class="files-col-date">${esc(when(entry.modified))}</span>
    <span class="files-col-kind">${esc(kindOf(entry))}</span>
    <span class="files-col-size">${entry.isDir ? esc(itemCount(entry.path)) : esc(fmtSize(entry.size))}</span>
  </div>`;
}

function drawItems() {
  const el = $('files-items');
  if (!el) return;
  el.className = `files-items files-items--${view.mode}`;
  const items = folderContents(view.index, view.folder);
  const head = view.mode === 'list'
    ? '<div class="files-list-head" aria-hidden="true"><span>Name</span><span>Modified</span><span>Type</span><span>Size</span></div>'
    : '';
  const empty = view.folder === 'sources'
    ? 'Nothing here yet. Upload files to give the team something to work from.'
    : 'This folder is empty.';
  el.innerHTML = items.length ? head + items.map(itemHtml).join('') : `<div class="files-empty">${esc(empty)}</div>`;
  for (const [mode, id] of [['list', 'files-view-list'], ['icons', 'files-view-icons']]) {
    $(id)?.setAttribute('aria-pressed', String(view.mode === mode));
  }
}

function drawPreview() {
  const pane = $('files-preview');
  if (!pane) return;
  const entry = view.selected ? view.index.get(view.selected) : null;
  const key = entry ? `${entry.path}|${entry.size}|${entry.modified}` : '';
  if (key === view.previewed) return;
  view.previewed = key;

  if (!entry) {
    pane.innerHTML = '<div class="files-preview-hint">Select a file to preview it here.</div>';
    return;
  }
  if (entry.isDir) {
    pane.innerHTML = `<div class="files-preview-head"><div class="files-preview-title"><span aria-hidden="true">📁</span> ${esc(entry.label)}</div>
      <div class="files-preview-meta">${itemCount(entry.path)}</div></div>
      <div class="files-preview-hint"><button type="button" class="files-btn" data-open="${esc(entry.path)}">Open folder</button></div>`;
    return;
  }
  const meta = [kindOf(entry), fmtSize(entry.size), when(entry.modified)].filter(Boolean).join(' · ');
  pane.innerHTML = `<div class="files-preview-head">
      <div class="files-preview-title" title="${esc(entry.path)}">${esc(entry.name)}</div>
      <div class="files-preview-meta">${esc(meta)}</div>
      <div class="files-preview-actions">
        <a class="files-btn" href="${esc(fileUrl(entry.path))}" download="${esc(entry.name)}"><img src="assets/download.svg" class="svg-icon" alt=""> Download</a>
        ${canPreview(entry.name) ? `<button type="button" class="files-btn" data-full="${esc(entry.path)}">Full screen</button>` : ''}
        <button type="button" class="files-btn" data-link="${esc(entry.path)}" title="Copy a link that opens the dashboard on this file">Copy link</button>
      </div>
    </div>
    <div class="files-preview-body file-viewer-body"></div>`;
  void renderPreview(pane.querySelector('.files-preview-body'), { name: entry.name, path: entry.path, size: entry.size });
}

function draw() {
  drawCrumbs();
  drawItems();
  drawPreview();
}

// ── Moving about ────────────────────────────────────────────────────────────

function openFolder(path) {
  view.folder = path;
  view.selected = null;
  draw();
  $('files-items')?.querySelector('.files-item')?.focus();
}

/**
 * Selecting only marks the items, not redraws them: a redraw between the two
 * clicks of a double-click would swallow the double-click.
 */
function select(path) {
  view.selected = path;
  for (const item of $('files-items')?.querySelectorAll('.files-item') ?? []) {
    const on = item.dataset.path === path;
    item.classList.toggle('files-item--selected', on);
    item.setAttribute('aria-selected', String(on));
    if (on && document.activeElement !== item) item.focus();
  }
  drawPreview();
}

/** Open what an item is: go into a folder, or show a file full-screen. */
function activate(path) {
  const entry = view.index.get(path);
  if (!entry) return;
  if (entry.isDir) openFolder(path);
  else openFileViewer(entry.name, entry.path, entry.size);
}

function initExplorer() {
  const items = $('files-items');
  items?.addEventListener('click', (e) => {
    const item = e.target.closest('.files-item');
    if (item) select(item.dataset.path);
  });
  items?.addEventListener('dblclick', (e) => {
    const item = e.target.closest('.files-item');
    if (item) activate(item.dataset.path);
  });
  items?.addEventListener('keydown', (e) => {
    const item = e.target.closest('.files-item');
    if (!item) return;
    if (e.key === 'Enter') { e.preventDefault(); activate(item.dataset.path); return; }
    if (e.key === ' ') { e.preventDefault(); select(item.dataset.path); return; }
    if (e.key === 'Backspace') { e.preventDefault(); $('files-up')?.click(); return; }
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const all = [...items.querySelectorAll('.files-item')];
    const next = all[all.indexOf(item) + step];
    if (next) select(next.dataset.path);
  });

  $('files-crumbs')?.addEventListener('click', (e) => {
    const crumb = e.target.closest('[data-folder]');
    if (crumb) openFolder(crumb.dataset.folder);
  });
  $('files-up')?.addEventListener('click', () => {
    const here = view.index.get(view.folder);
    if (here?.parent !== null && here?.parent !== undefined) openFolder(here.parent);
  });
  for (const mode of ['list', 'icons']) {
    $(`files-view-${mode}`)?.addEventListener('click', () => {
      view.mode = mode;
      try { localStorage.setItem(MODE_KEY, mode); } catch { /* remembered for this visit only */ }
      drawItems();
    });
  }
  $('files-preview')?.addEventListener('click', (e) => {
    const open = e.target.closest('[data-open]');
    if (open) { openFolder(open.dataset.open); return; }
    const full = e.target.closest('[data-full]');
    if (full) { activate(full.dataset.full); return; }
    const link = e.target.closest('[data-link]');
    if (link) void copyWithFeedback(dashboardLinkFor(link.dataset.link), link);
  });
}

// ── Data ────────────────────────────────────────────────────────────────────

/** New lists from the runner. A part left out (an upload sends no tickets) is kept. */
export function renderFilesList(sources, outputs, tickets) {
  view.listing = {
    sources: sources ?? view.listing.sources,
    outputs: outputs ?? view.listing.outputs,
    tickets: tickets ?? view.listing.tickets,
  };
  view.index = buildIndex(view.listing);
  view.folder = existingFolder(view.index, view.folder);
  if (view.selected && !view.index.has(view.selected)) view.selected = null;
  draw();
}

export function fetchFiles() {
  fetch('/api/project/files')
    .then(r => r.json())
    .then(data => renderFilesList(data.sources, data.outputs, data.tickets))
    .catch(() => {});
}

export function startFilesRefresh() {
  if (filesRefreshTimer) clearInterval(filesRefreshTimer);
  filesRefreshTimer = setInterval(fetchFiles, 30_000);
}

export function initFileUpload() {
  initExplorer();
  initFilesActions({ refresh: fetchFiles, showSources: () => openFolder('sources') });
  draw();
}
