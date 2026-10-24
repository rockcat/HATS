// ── External service status — the dots in the header ─────────────────────────
//
// Every service the runner talks to is optional, so a missing one fails quietly:
// no voices, the local agents.json instead of the library. This makes it visible.

const POLL_MS = 15_000;

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
