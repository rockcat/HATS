// ── Files panel ───────────────────────────────────────────────────────────────

import { esc } from './utils.js';
import { fmtSize, fileIcon, fileExt } from './utils.js';
import { getBackgrounds } from './avatars.js';

const VIEWABLE_EXTS = new Set(['txt', 'md', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);

let filesRefreshTimer = null;

export function buildFileTree(files) {
  const nodeMap = new Map();
  const roots   = [];
  for (const f of files) nodeMap.set(f.relativePath, { ...f, children: [] });
  for (const f of files) {
    const node  = nodeMap.get(f.relativePath);
    const parts = f.relativePath.split('/');
    parts.pop();
    const parent = nodeMap.get(parts.join('/'));
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export function renderFileNode(node) {
  if (node.isDir) {
    const inner = node.children.map(renderFileNode).join('') || '<div class="files-list-empty">Empty</div>';
    return `<details class="file-tree-dir" open>
      <summary class="file-row file-row--dir">
        <span class="file-icon">${fileIcon(node.name, true)}</span>
        <span class="file-name" title="${esc(node.relativePath)}">${esc(node.name)}</span>
      </summary>
      ${inner}
    </details>`;
  }
  return `<div class="file-row">
    <span class="file-icon">${fileIcon(node.name, false)}</span>
    <span class="file-name" title="${esc(node.relativePath)}">${esc(node.name)}</span>
    <span class="file-size">${fmtSize(node.size)}</span>
    ${buildFileActions(node)}
  </div>`;
}

export function renderFilesSection(elId, files) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!files || files.length === 0) {
    el.innerHTML = `<div class="files-list-empty">No files yet</div>`;
    return;
  }
  el.innerHTML = buildFileTree(files).map(renderFileNode).join('');
}

function buildFileActions(f) {
  const url    = `/api/project/file?path=${encodeURIComponent(f.relativePath)}`;
  const canView = VIEWABLE_EXTS.has(fileExt(f.name));
  const viewBtn = canView
    ? `<button class="file-action-btn file-view-btn" title="View" data-name="${esc(f.name)}" data-path="${esc(f.relativePath)}"><img src="/assets/preview.svg" class="svg-icon" alt="Preview"></button>`
    : `<span class="file-action-placeholder"></span>`;
  const dlBtn   = `<a class="file-action-btn" title="Download" href="${esc(url)}" download="${esc(f.name)}"><img src="/assets/download.svg" class="svg-icon" alt="Download"></a>`;
  return `<span class="file-actions">${viewBtn}${dlBtn}</span>`;
}

export function initFileViewer() {
  document.addEventListener('click', e => {
    const btn = e.target.closest('.file-view-btn');
    if (!btn) return;
    openFileViewer(btn.dataset.name, btn.dataset.path);
  });

  document.addEventListener('dblclick', e => {
    const row = e.target.closest('.file-row:not(.file-row--dir)');
    if (!row) return;
    const viewBtn = row.querySelector('.file-view-btn');
    if (viewBtn) {
      openFileViewer(viewBtn.dataset.name, viewBtn.dataset.path);
    } else {
      const dlLink = row.querySelector('a.file-action-btn[download]');
      if (dlLink) dlLink.click();
    }
  });

  document.getElementById('file-viewer-close').addEventListener('click', () => {
    document.getElementById('file-viewer-modal').hidden = true;
  });
  document.getElementById('file-viewer-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) document.getElementById('file-viewer-modal').hidden = true;
  });
}

export function initGenBgModal() {
  const modal       = document.getElementById('gen-bg-modal');
  const closeBtn    = document.getElementById('gen-bg-close');
  const cancelBtn   = document.getElementById('gen-bg-cancel');
  const submitBtn   = document.getElementById('gen-bg-submit');
  const spinner     = document.getElementById('gen-bg-spinner');
  const preview     = document.getElementById('gen-bg-preview');
  const errorEl     = document.getElementById('gen-bg-error');
  const nameInput   = document.getElementById('gen-bg-name');
  const promptInput = document.getElementById('gen-bg-prompt');

  const close = () => {
    modal.hidden = true;
    nameInput.value   = '';
    promptInput.value = '';
    preview.hidden    = true;
    errorEl.textContent = '';
  };
  closeBtn.addEventListener('click', close);
  cancelBtn.addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });

  for (const el of [nameInput, promptInput]) {
    el.addEventListener('keydown', e => { if (e.key === 'Enter') submitBtn.click(); });
  }

  submitBtn.addEventListener('click', async () => {
    const name   = nameInput.value.trim();
    const prompt = promptInput.value.trim();
    if (!name)   { errorEl.textContent = 'Please enter a name for the background.'; return; }
    if (!prompt) { errorEl.textContent = 'Please enter a scene description.'; return; }
    errorEl.textContent  = '';
    submitBtn.disabled   = true;
    preview.hidden       = true;
    spinner.hidden       = false;

    try {
      const res  = await fetch('/api/images/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, prompt }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { errorEl.textContent = data.error ?? 'Generation failed'; return; }
      const img = document.getElementById('gen-bg-img');
      img.src   = `/backgrounds/${encodeURIComponent(data.filename)}`;
      preview.hidden = false;
      await getBackgrounds(true);
      populateBackgroundSelect(data.filename, 'add-agent-background');
      close();
    } catch (err) {
      errorEl.textContent = err.message || 'Generation failed';
    } finally {
      spinner.hidden     = true;
      submitBtn.disabled = false;
    }
  });
}

export async function populateBackgroundSelect(selectedFile, selId = 'add-agent-background') {
  const sel = document.getElementById(selId);
  if (!sel) return;
  const backgrounds = await getBackgrounds();
  sel.innerHTML = '<option value="">(no background)</option>';
  for (const f of backgrounds) {
    const opt = document.createElement('option');
    opt.value = f;
    opt.textContent = f.replace(/\.[^.]+$/, '');
    sel.appendChild(opt);
  }
  if (selectedFile) sel.value = selectedFile;
}

export function openFileViewer(name, relativePath) {
  const url  = `/api/project/file?path=${encodeURIComponent(relativePath)}`;
  const ext  = fileExt(name);
  const modal = document.getElementById('file-viewer-modal');
  const body  = document.getElementById('file-viewer-body');
  const dl    = document.getElementById('file-viewer-download');

  document.getElementById('file-viewer-name').textContent = name;
  dl.href     = url;
  dl.download = name;
  body.innerHTML = '';

  const imgExts = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
  if (ext === 'pdf') {
    body.innerHTML = `<iframe src="${esc(url)}" class="file-viewer-iframe"></iframe>`;
  } else if (imgExts.has(ext)) {
    body.innerHTML = `<div class="file-viewer-img-wrap"><img src="${esc(url)}" class="file-viewer-img" alt="${esc(name)}"></div>`;
  } else {
    body.innerHTML = `<div class="file-viewer-loading">Loading…</div>`;
    fetch(url)
      .then(r => r.text())
      .then(text => {
        if (ext === 'md') {
          const html = window.marked ? window.marked.parse(text) : `<pre>${esc(text)}</pre>`;
          body.innerHTML = `<div class="file-viewer-md">${html}</div>`;
        } else {
          body.innerHTML = `<pre class="file-viewer-pre">${esc(text)}</pre>`;
        }
      })
      .catch(() => { body.innerHTML = `<div class="file-viewer-loading">Failed to load file.</div>`; });
  }

  modal.hidden = false;
}

export function renderFilesList(sources, outputs, tickets) {
  renderFilesSection('files-sources-list', sources);
  renderFilesSection('files-outputs-list', outputs);

  const section = document.getElementById('files-tickets-section');
  const list    = document.getElementById('files-tickets-list');
  if (!section || !list) return;

  if (!tickets || tickets.length === 0) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  list.innerHTML = tickets.map(t => {
    const inner = buildFileTree(t.files).map(renderFileNode).join('') || '<div class="files-list-empty">Empty</div>';
    return `<details class="files-ticket-group" open>
      <summary class="files-ticket-header">${esc(t.id)}</summary>
      ${inner}
    </details>`;
  }).join('');
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
  document.getElementById('files-open-folder-btn')?.addEventListener('click', () => {
    fetch('/api/project/open-folder', { method: 'POST' }).catch(() => {});
  });

  document.getElementById('files-clear-btn')?.addEventListener('click', async () => {
    if (!confirm('Clear all project files, tickets, and agent history? Agent definitions will be kept. This cannot be undone.')) return;
    const btn = document.getElementById('files-clear-btn');
    btn.disabled = true;
    btn.textContent = 'Clearing…';
    try {
      const r = await fetch('/api/project/clear', { method: 'POST' });
      if (!r.ok) { const d = await r.json(); alert('Clear failed: ' + (d.error ?? r.status)); }
      else fetchFiles();
    } catch (err) {
      alert('Clear failed: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Clear project';
    }
  });

  const input = document.getElementById('files-upload-input');
  if (!input) return;
  input.addEventListener('change', async () => {
    const files = [...input.files];
    input.value = '';
    for (const file of files) {
      try {
        await fetch('/api/project/upload', {
          method: 'POST',
          headers: { 'X-Filename': encodeURIComponent(file.name) },
          body: file,
        });
      } catch { /* ignore */ }
    }
    fetchFiles();
  });
}
