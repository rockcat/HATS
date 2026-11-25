// ── Project Files toolbar: open the folder, upload, clear ───────────────────

import { notify } from './notice.js';

/**
 * What to say when the runner could not open the folder itself — in Docker it
 * never can, as there is no desktop in the container to open it on.
 */
export function folderNoteText({ path, inDataFolder, error }) {
  if (error) return `Could not open it (${error}). It is at ${path}`;
  return inDataFolder
    ? `In your HATS data folder, at ${path}`
    : `The runner has no desktop to open it on. It is at ${path}`;
}

function showFolderNote(text, copyable) {
  const note = document.getElementById('files-open-folder-note');
  if (!note) return;
  note.hidden = !text;
  note.textContent = text ?? '';
  if (!text || !copyable || !navigator.clipboard) return;
  const copy = document.createElement('button');
  copy.className = 'files-open-folder-copy';
  copy.textContent = 'Copy';
  copy.addEventListener('click', () =>
    navigator.clipboard.writeText(copyable).then(() => { copy.textContent = 'Copied'; }).catch(() => {}));
  note.append(' ', copy);
}

/**
 * Open folder is always offered. Where the runner can open it on this
 * machine it does; in Docker, which has no desktop, it says where the folder
 * is on your machine instead, ready to copy.
 */
function initOpenFolder() {
  const btn = document.getElementById('files-open-folder-btn');
  if (!btn) return;
  fetch('/api/project').then(r => r.json()).then(p => {
    btn.title = p.canOpenFolder ? 'Open the project folder on this computer' : 'Show where the project folder is on your computer';
  }).catch(() => {});

  btn.addEventListener('click', async () => {
    try {
      const r = await fetch('/api/project/open-folder', { method: 'POST' });
      const body = await r.json();
      if (!r.ok) showFolderNote(body.error ?? 'Could not open the folder');
      else if (!body.opened) showFolderNote(folderNoteText(body), body.path);
      else showFolderNote(null);
    } catch {
      showFolderNote('Could not reach the runner');
    }
  });
}

function initClear(onChange) {
  const btn = document.getElementById('files-clear-btn');
  btn?.addEventListener('click', async () => {
    if (!confirm('Clear all project files, tickets, and agent history? Agent definitions will be kept. This cannot be undone.')) return;
    btn.disabled = true;
    btn.textContent = 'Clearing…';
    try {
      const r = await fetch('/api/project/clear', { method: 'POST' });
      if (!r.ok) { const d = await r.json().catch(() => ({})); notify(`Clear failed: ${d.error ?? r.status}`, 'error'); }
      else onChange();
    } catch (err) {
      notify(`Clear failed: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Clear project';
    }
  });
}

/** Uploads go to sources/, the only folder the runner takes them into. */
function initUpload(onUploaded) {
  const input = document.getElementById('files-upload-input');
  input?.addEventListener('change', async () => {
    const files = [...input.files];
    input.value = '';
    const failed = [];
    for (const file of files) {
      try {
        const r = await fetch('/api/project/upload', {
          method: 'POST',
          headers: { 'X-Filename': encodeURIComponent(file.name) },
          body: file,
        });
        if (!r.ok) failed.push(file.name);
      } catch { failed.push(file.name); }
    }
    if (failed.length) notify(`Could not upload ${failed.join(', ')}`, 'error');
    onUploaded();
  });
}

/** Wire the toolbar. `refresh` reloads the files; `showSources` opens that folder. */
export function initFilesActions({ refresh, showSources }) {
  initOpenFolder();
  initClear(refresh);
  initUpload(() => { showSources(); refresh(); });
}
