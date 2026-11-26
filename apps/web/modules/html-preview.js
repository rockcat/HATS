// ── Previewing an HTML file, safely ─────────────────────────────────────────
//
// An HTML file in a project was written by an agent, perhaps from a web page
// it read, so it is treated as untrusted. It is shown in a sandboxed iframe
// (see SANDBOX), never at the dashboard's own address: there, its scripts
// would run signed in as you, able to call the runner's API.
//
// By default no script runs and nothing loads from the network: the policy
// below allows only the page's own styles and inline images. "Run scripts"
// lets its scripts run and reach the network, still inside the sandbox, so
// it never reaches the dashboard or your session.
//
// No imports and no DOM, so it is directly testable.

/** Without allow-same-origin the page has no origin: no cookies, no dashboard. */
export const SANDBOX = { still: '', scripts: 'allow-scripts' };

const STILL_POLICY = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:";

/**
 * The document to put in the iframe's srcdoc. A policy set first in the
 * document holds however the page continues: a later one can only add limits.
 */
export function htmlForPreview(html, { scripts = false } = {}) {
  if (scripts) return html;
  return `<meta http-equiv="Content-Security-Policy" content="${STILL_POLICY}">\n${html}`;
}
