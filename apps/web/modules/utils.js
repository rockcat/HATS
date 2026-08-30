// ── Utility helpers ───────────────────────────────────────────────────────────
// No imports — only pure functions and window.marked (CDN global).

export function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Alias — identical implementation, used in calendar / schedules sections.
export const escHtml = esc;

export function mdSafe(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.className = 'feed-md';
  if (window.marked) div.innerHTML = window.marked.parse(text);
  else               div.textContent = text;
  return div.outerHTML;
}

export function truncate(s, n) {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

export function fmtTokens(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

export function fmtSize(bytes) {
  if (bytes === 0) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export function fileIcon(name, isDir) {
  if (isDir) return '';
  const ext = name.split('.').pop()?.toLowerCase();
  const icons = {
    pdf: '📄', docx: '📝', doc: '📝', xlsx: '📊', xls: '📊', md: '📋',
    txt: '📋', png: '🖼', jpg: '🖼', jpeg: '🖼', gif: '🖼', mp4: '🎬',
    mp3: '🎵', zip: '📦', csv: '📊', json: '⚙️', ts: '⚙️', js: '⚙️',
  };
  return icons[ext] || '📄';
}

export function fileExt(name) {
  return name.split('.').pop()?.toLowerCase() ?? '';
}
