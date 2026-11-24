// file-links.js — links to one project file.
//
// A link to the dashboard with ?file= opens it showing that file, so a draft an
// agent wants approved can be handed on as a link. It works wherever the
// dashboard does, Docker included, which a folder on the runner's disk does not.

/** Where the runner serves a project file. */
export const fileUrl = (path) => `/api/project/file?path=${encodeURIComponent(path)}`;

/** The dashboard, opening on this file. */
export function dashboardLinkFor(path, loc = window.location) {
  return `${loc.origin}${loc.pathname}?file=${encodeURIComponent(path)}`;
}

/** The file a dashboard link asks to open, if any. */
export function fileFromSearch(search) {
  const p = new URLSearchParams(search).get('file');
  return p && !p.split('/').includes('..') ? p : null;
}

/** The name a path ends in. */
export const baseName = (path) => path.split('/').pop() || path;

/** Copy text, saying so on the button that asked. */
export async function copyWithFeedback(text, btn) {
  const was = btn.textContent;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copied';
  } catch {
    // No clipboard outside a secure context; show it to copy by hand.
    window.prompt('Copy this link:', text);
  }
  setTimeout(() => { btn.textContent = was; }, 1500);
}
