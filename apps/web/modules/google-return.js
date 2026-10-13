// ── Coming back from a Google sign-in ────────────────────────────────────────
//
// The sign-in normally runs in a window this page opened, and that window
// reports back over postMessage. When the browser blocks the popup the whole
// thing happens in this tab instead, and we return here with the outcome in
// the query string — with nobody listening for a message that will never come.
//
// Without this the dashboard would reload looking completely normal, with the
// result of the sign-in visible only as `?google=success` in the address bar.

/**
 * What a return from Google says, or null if this is an ordinary page load.
 *
 * Pure, so the parsing can be tested without a browser.
 *
 * @param {string} search  e.g. '?google=success&email=a@b.c'
 */
export function parseGoogleReturn(search) {
  const params = new URLSearchParams(search ?? '');
  const result = params.get('google');
  if (result !== 'success' && result !== 'error') return null;
  return {
    ok: result === 'success',
    agent: params.get('agent') ?? null,
    email: params.get('email') ?? null,
    reason: params.get('reason') ?? null,
  };
}

/** What to tell the user about it. */
export function googleReturnMessage(outcome) {
  if (!outcome) return '';
  const who = outcome.agent ? `${outcome.agent}'s Google account` : 'Google account';
  if (outcome.ok) {
    return outcome.email
      ? `${who} connected as ${outcome.email}.`
      : `${who} connected.`;
  }
  return `Could not connect ${who}: ${outcome.reason ?? 'no reason given'}.`;
}

/**
 * Act on a return, if this load is one.
 *
 * The query string is cleared afterwards so a refresh does not replay the
 * message, and so the address bar stops advertising which account was used.
 */
export function initGoogleReturn({ announce, showMcpTab } = {}) {
  const outcome = parseGoogleReturn(window.location.search);
  if (!outcome) return null;

  announce?.(googleReturnMessage(outcome));
  if (!outcome.agent) showMcpTab?.();

  window.history.replaceState({}, '', window.location.pathname);
  return outcome;
}
