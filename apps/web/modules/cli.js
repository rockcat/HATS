// ── Chat section ─────────────────────────────────────────────────────────────
//
// Choosing which agent to talk to, and running the commands typed into the
// message box (see chat-commands.js). The conversation itself is the
// <conversation-threads> element in thread-viewer.js.

import { state } from './state.js';
import { chatCommand } from './chat-commands.js';
import { notify } from './notice.js';

let cliInited = false;

/** Run a command line, and show its answer. */
async function runCommand(line) {
  try {
    const res = await fetch('/api/cli', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line }),
    });
    const data = await res.json().catch(() => ({}));
    notify(data.output || data.error || `${line}: done`, res.ok ? 'info' : 'error');
  } catch (err) {
    notify(`Could not run "${line}": ${err?.message ?? err}`, 'error');
  }
}

export function initCLI() {
  if (cliInited) return;
  cliInited = true;

  document.getElementById('chat-agent-select')?.addEventListener('change', updateChatThreads);
  updateChatAgentSelect();

  // A conversation asks before sending; a command is claimed and run instead.
  document.addEventListener('chat-compose', (e) => {
    const line = chatCommand(e.detail?.text);
    if (!line) return;
    e.preventDefault();
    void runCommand(line);
  });
}

export function updateChatAgentSelect() {
  const sel = document.getElementById('chat-agent-select');
  if (!sel) return;
  const prev   = sel.value;
  const agents = state.agents ?? [];
  sel.innerHTML = '<option value="">— select agent —</option>';
  for (const a of agents) {
    const opt = document.createElement('option');
    opt.value = a.name;
    opt.textContent = a.name;
    sel.appendChild(opt);
  }
  if (prev && sel.querySelector(`option[value="${CSS.escape(prev)}"]`)) {
    sel.value = prev;
  } else if (agents.length) {
    sel.value = agents[0].name;
  }
  updateChatThreads();
}

export function updateChatThreads() {
  const sel = document.getElementById('chat-agent-select');
  const el  = document.getElementById('chat-threads');
  if (!sel || !el) return;
  const name = sel.value;
  if (name) el.setAttribute('agent', name);
  else el.removeAttribute('agent');
}

export function appendCLIAgent(from) {
  const sel = document.getElementById('chat-agent-select');
  if (sel && from && sel.value !== from) {
    const opt = sel.querySelector(`option[value="${CSS.escape(from)}"]`);
    if (opt) { sel.value = from; updateChatThreads(); }
  }
  document.getElementById('chat-threads')?._refresh();
}
