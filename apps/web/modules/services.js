// ── External service status — the dots in the header ─────────────────────────
//
// Every service the runner talks to is optional, so a missing one fails quietly:
// no voices, the local agents.json instead of the library. This makes it visible.

const POLL_MS = 15_000;

/**
 * A service URL the browser can use. Inside Docker the runner reaches the
 * host as host.docker.internal, which the browser may not resolve — the
 * dashboard's own host is the same machine.
 */
export function browserUrl(url, here = window.location) {
  try {
    const u = new URL(url);
    if (u.hostname === 'host.docker.internal') u.hostname = here.hostname;
    return u.toString();
  } catch {
    return null;
  }
}

function describe(s) {
  if (!s.enabled) return `${s.label}: not used (standalone)`;
  return `${s.label}: ${s.connected ? 'connected' : 'not answering'} — ${s.url}`;
}

function render(container, services) {
  container.replaceChildren(...services.map(s => {
    const pill = document.createElement('span');
    pill.className = 'service-pill';
    pill.title = describe(s);

    const dot = document.createElement('span');
    dot.className = 'status-dot' + (s.connected ? ' connected' : s.enabled ? ' down' : ' off');

    const label = document.createElement('span');
    label.textContent = s.label;

    pill.append(dot, label);

    const href = s.connected && s.openUrl ? browserUrl(s.openUrl) : null;
    if (href) {
      const open = document.createElement('a');
      open.className = 'service-open';
      open.href = href;
      open.target = '_blank';
      open.rel = 'noopener';
      open.title = `Open ${s.id === 'project-server' ? 'the Project Designer' : s.label} in a new tab`;
      open.textContent = '↗';
      pill.append(open);
    }
    return pill;
  }));
}

async function refresh(container) {
  try {
    const r = await fetch('/api/services');
    if (!r.ok) return; // signed out — keep whatever was last shown
    render(container, await r.json());
  } catch {
    // The runner itself is unreachable; the connection dot already says so.
  }
}

export function initServiceStatus() {
  const container = document.getElementById('service-status');
  if (!container) return;
  refresh(container);
  setInterval(() => refresh(container), POLL_MS);
}
