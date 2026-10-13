// ── The page Google sends you back to ─────────────────────────────────────────
//
// The sign-in can be opened two ways, and the page that ends it has to handle
// both. In a window this page opened, it tells the opener what happened and
// closes itself. In the dashboard's own tab — which is where a blocked popup
// leaves us — there is nothing to tell and nothing to close, so it goes back
// to where it started instead of stranding the user on a page that says "you
// can close this window" about a window they cannot close.

export interface FinishOptions {
  success: boolean;
  /** Why it failed, in words the user can act on. Ignored on success. */
  message?: string;
  /** The agent this sign-in was for, on the per-agent flow. */
  agent?: string;
  /** Which account was connected, when Google told us. */
  email?: string;
}

/** Where the dashboard should land when there is no opener to notify. */
export function returnUrl(options: FinishOptions): string {
  const params = new URLSearchParams({ google: options.success ? 'success' : 'error' });
  if (!options.success && options.message) params.set('reason', options.message);
  if (options.agent) params.set('agent', options.agent);
  if (options.success && options.email) params.set('email', options.email);
  return `/?${params.toString()}`;
}

/** What the user reads, in the second before the page moves on. */
function headline(options: FinishOptions): string {
  if (options.success) {
    return options.email
      ? `Connected as ${options.email}.`
      : 'Google account connected.';
  }
  return `Sign-in failed: ${options.message ?? 'no reason given'}.`;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * JSON safe to embed in a `<script>` block.
 *
 * `JSON.stringify` is not enough on its own: a `</script>` inside a string
 * still ends the block as far as the HTML parser is concerned, and everything
 * after it is markup. `message` is whatever arrived in Google's `error`
 * parameter, so anyone who can send someone to the callback URL controls it —
 * reflected script on the origin that holds the session cookie.
 *
 * The line separators are escaped for the older parsers that reject them
 * inside a string literal.
 */
const scriptJson = (value: unknown) =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

/**
 * Build the page that ends the OAuth round trip.
 *
 * Every value reaching the script goes through JSON.stringify: `message` is
 * whatever Google put in an error parameter, and it lands inside a script tag.
 */
export function finishPage(options: FinishOptions): string {
  const payload = scriptJson({
    type: options.success ? 'google-auth-success' : 'google-auth-error',
    error: options.success ? '' : (options.message ?? ''),
    ...(options.agent ? { agent: options.agent } : {}),
    ...(options.email ? { email: options.email } : {}),
  });

  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Google sign-in</title>
<style>
  body { font: 14px system-ui, sans-serif; margin: 0; display: grid; place-items: center;
         height: 100vh; background: #0d1117; color: #e6edf3; }
  p { margin: 0; }
  a { color: #6ea8ff; }
</style></head>
<body>
<p>${escapeHtml(headline(options))} <a href="${escapeHtml(returnUrl(options))}">Back to HATS</a></p>
<script>
  (function () {
    var payload = ${payload};
    if (window.opener && !window.opener.closed) {
      // Same origin: the dashboard and this page are both served by the runner,
      // so there is no reason to post to "*".
      try { window.opener.postMessage(payload, window.location.origin); } catch (e) {}
      window.close();
      return;
    }
    // No opener — a blocked popup, or a window the user reopened. Go back.
    window.location.replace(${scriptJson(returnUrl(options))});
  })();
</script>
</body>
</html>`;
}
