// ── Previewing a project file ────────────────────────────────────────────────
//
// One list of previewers, used by the preview pane in Project Files and by the
// file viewer that opens from Requests and from links to a file. To preview a
// new kind of file, add an entry to PREVIEWERS: the extensions it takes,
// whether it wants the file's text, and how to draw it.

import { esc, fileExt } from './utils.js';
import { parseCsv } from './csv.js';
import { fileUrl, dashboardLinkFor, fileFromSearch, baseName, copyWithFeedback } from './file-links.js';

/** Text larger than this is not loaded to preview; download it instead. */
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const CSV_ROWS = 500;

const TEXT_EXTS = ['txt', 'log', 'js', 'mjs', 'ts', 'py', 'html', 'css', 'xml', 'yaml', 'yml', 'sh', 'sql', 'ini', 'toml', 'env'];

const PREVIEWERS = [
  {
    exts: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'],
    render: (el, { url, name }) => {
      el.innerHTML = `<div class="file-viewer-img-wrap"><img src="${esc(url)}" class="file-viewer-img" alt="${esc(name)}"></div>`;
    },
  },
  {
    exts: ['pdf'],
    render: (el, { url }) => { el.innerHTML = `<iframe src="${esc(url)}" class="file-viewer-iframe" title="PDF preview"></iframe>`; },
  },
  {
    exts: ['md'], text: true,
    render: (el, { text }) => {
      const html = window.marked ? window.marked.parse(text) : `<pre>${esc(text)}</pre>`;
      el.innerHTML = `<div class="file-viewer-md">${html}</div>`;
    },
  },
  {
    exts: ['csv'], text: true,
    render: (el, { text }) => {
      const { rows, total } = parseCsv(text, CSV_ROWS + 1);
      const [head = [], ...body] = rows;
      const more = total > rows.length ? `<div class="file-preview-note">Showing the first ${body.length} of ${total - 1} rows.</div>` : '';
      el.innerHTML = `${more}<div class="file-preview-table-wrap"><table class="file-preview-table">
        <thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>`;
    },
  },
  {
    exts: ['json'], text: true,
    render: (el, { text }) => {
      let shown = text;
      try { shown = JSON.stringify(JSON.parse(text), null, 2); } catch { /* show it as it is */ }
      el.innerHTML = `<pre class="file-viewer-pre">${esc(shown)}</pre>`;
    },
  },
  {
    exts: TEXT_EXTS, text: true,
    render: (el, { text }) => { el.innerHTML = `<pre class="file-viewer-pre">${esc(text)}</pre>`; },
  },
];

function previewerFor(name) {
  const ext = fileExt(name);
  return PREVIEWERS.find((p) => p.exts.includes(ext)) ?? null;
}

/** Whether a file of this name can be shown, rather than only downloaded. */
export function canPreview(name) {
  return !!previewerFor(name);
}

const message = (el, text) => { el.innerHTML = `<div class="file-viewer-loading">${esc(text)}</div>`; };

/**
 * Draw a preview of a project file into `el`. A newer call for the same
 * element wins, so clicking quickly through files never shows a stale one.
 */
export async function renderPreview(el, { name, path, size }) {
  const token = Symbol('preview');
  el._previewToken = token;
  const previewer = previewerFor(name);
  if (!previewer) return message(el, 'This kind of file cannot be shown here yet. Download it to open it.');
  const url = fileUrl(path);
  if (!previewer.text) return previewer.render(el, { url, name });
  if (size > MAX_TEXT_BYTES) return message(el, 'This file is too large to preview. Download it to open it.');

  message(el, 'Loading…');
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const text = await res.text();
    if (el._previewToken === token) previewer.render(el, { url, name, text });
  } catch {
    if (el._previewToken === token) message(el, 'Could not load this file.');
  }
}

// ── The file viewer: a preview that fills the screen ────────────────────────

export function openFileViewer(name, relativePath, size = 0) {
  const modal = document.getElementById('file-viewer-modal');
  const dl    = document.getElementById('file-viewer-download');
  document.getElementById('file-viewer-name').textContent = name;
  modal.dataset.path = relativePath;
  dl.href     = fileUrl(relativePath);
  dl.download = name;
  modal.hidden = false;
  void renderPreview(document.getElementById('file-viewer-body'), { name, path: relativePath, size });
}

export function initFileViewer() {
  const modal = document.getElementById('file-viewer-modal');
  document.getElementById('file-viewer-copy-link').addEventListener('click', (e) => {
    if (modal.dataset.path) void copyWithFeedback(dashboardLinkFor(modal.dataset.path), e.currentTarget);
  });
  document.getElementById('file-viewer-close').addEventListener('click', () => { modal.hidden = true; });
  modal.addEventListener('click', (e) => { if (e.target === e.currentTarget) modal.hidden = true; });

  // A dashboard link to a file opens on it.
  const linked = fileFromSearch(window.location.search);
  if (linked) openFileViewer(baseName(linked), linked);
}
