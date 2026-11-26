// ── Notices ──────────────────────────────────────────────────────────────────
//
// Short messages in the corner: a command's answer, a microphone that cannot
// be used, a transcription that failed. They used to be written into a CLI
// output pane that the page no longer has, so they went nowhere at all.

const SHOW_MS = { info: 6000, error: 12000 };

function stack() {
  let el = document.getElementById('notices');
  if (!el) {
    el = document.createElement('div');
    el.id = 'notices';
    el.className = 'notices';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  return el;
}

/** Show `text` for a while. `kind` is 'info' or 'error'. */
export function notify(text, kind = 'info') {
  if (!text) return;
  const note = document.createElement('div');
  note.className = `notice notice--${kind}`;
  const body = document.createElement('span');
  body.className = 'notice-text';
  body.textContent = text;
  const close = document.createElement('button');
  close.className = 'notice-close';
  close.title = 'Dismiss';
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = '×';
  const dismiss = () => note.remove();
  close.addEventListener('click', dismiss);
  note.append(body, close);
  stack().appendChild(note);
  setTimeout(dismiss, SHOW_MS[kind] ?? SHOW_MS.info);
}
