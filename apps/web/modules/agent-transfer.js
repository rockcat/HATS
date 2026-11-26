// agent-transfer.js — duplicate, save, load and send one agent, or make a template of it.
//
// The work is the runner's; this asks for names, picks files and says what
// happened. A name already taken — here, on the other runner, or in the
// library — is asked for again rather than failing.

import { state } from './state.js';

const SEND_URL_KEY = 'agentSendUrl';

/** A name like `name` that none of `taken` has, ignoring case: "Poppy 2", "Poppy 3"… */
export function freeName(name, taken) {
  const used = new Set(taken.map(t => t.toLowerCase()));
  const base = name.trim().replace(/\s+\d+$/, '');
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/** The file name a download was offered under, or a fallback. */
export function downloadName(disposition, fallback) {
  return disposition?.match(/filename="?([^";]+)"?/i)?.[1] ?? fallback;
}

const localNames = () => state.agents.map(a => a.name);

function setStatus(text, isError = false) {
  const el = document.getElementById('agent-transfer-status');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('agent-transfer-status--error', isError);
}

async function errorOf(res) {
  const body = await res.json().catch(() => ({}));
  return body.error ?? `${res.status} ${res.statusText}`;
}

/**
 * Run `attempt(name)` until it is not refused for a taken name, asking for
 * another each time. Returns the last response, or null if cancelled.
 * `name` may start empty, for a saved file whose name only the runner knows.
 */
async function withFreeName(firstName, taken, attempt) {
  let name = firstName;
  for (;;) {
    const res = await attempt(name);
    const body = await res.clone().json().catch(() => ({}));
    if (res.status !== 409 && body.remoteStatus !== 409) return res;
    const tried = body.name ?? name;
    const next = prompt(`${body.error ?? 'That name is taken'}. Give it another name:`, freeName(tried, [...taken, tried]));
    if (!next?.trim()) return null;
    name = next.trim();
  }
}

async function duplicate(agent) {
  const name = prompt(`Duplicate "${agent}" — name for the copy:`, freeName(agent, localNames()));
  if (!name?.trim()) return;
  setStatus('Duplicating…');
  const res = await withFreeName(name.trim(), localNames(), (n) =>
    fetch(`/api/agents/${encodeURIComponent(agent)}/duplicate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: n }),
    }));
  if (!res) { setStatus(''); return; }
  if (!res.ok) { setStatus(await errorOf(res), true); return; }
  const report = await res.json();
  setStatus(`Duplicated as "${report.name}", with ${report.threads} thread${report.threads === 1 ? '' : 's'}.`);
}

async function saveToFile(agent, withLogins) {
  setStatus('Saving…');
  const res = await fetch(`/api/agents/${encodeURIComponent(agent)}/export${withLogins ? '?credentials=true' : ''}`);
  if (!res.ok) { setStatus(await errorOf(res), true); return; }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = downloadName(res.headers.get('Content-Disposition'), `${agent}.hats-agent.zip`);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  setStatus(`Saved${withLogins ? ' with its logins — keep the file safe' : ''}.`);
}

async function sendToRunner(agent, withLogins) {
  const url = document.getElementById('agent-send-url').value.trim();
  const apiKey = document.getElementById('agent-send-key').value.trim();
  if (!url || !apiKey) { setStatus('Give the other runner\'s address and an API key from it.', true); return; }
  try { localStorage.setItem(SEND_URL_KEY, url); } catch { /* not kept */ }
  setStatus(`Sending to ${url}…`);
  const res = await withFreeName(agent, [], (name) =>
    fetch(`/api/agents/${encodeURIComponent(agent)}/send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, apiKey, name, credentials: withLogins }),
    }));
  if (!res) { setStatus(''); return; }
  if (!res.ok) { setStatus(await errorOf(res), true); return; }
  const report = await res.json();
  setStatus(`Sent: it is "${report.name}" on ${url}.`);
}

async function addToLibrary(agent) {
  const name = prompt(`Add "${agent}" to the library as a new template, named:`, agent);
  if (!name?.trim()) return;
  setStatus('Adding to the library…');
  const res = await fetch(`/api/agents/${encodeURIComponent(agent)}/to-library`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }),
  });
  if (!res.ok) { setStatus(await errorOf(res), true); return; }
  setStatus(`Added to the library as "${(await res.json()).name}".`);
}

async function loadFromFile(file) {
  const bytes = await file.arrayBuffer();
  const res = await withFreeName('', localNames(), (name) =>
    fetch(`/api/agents/import${name ? `?name=${encodeURIComponent(name)}` : ''}`, {
      method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: bytes,
    }));
  if (!res) return;
  if (!res.ok) { alert(`Could not load the agent: ${await errorOf(res)}`); return; }
  const report = await res.json();
  const notes = [...(report.warnings ?? [])];
  if (report.voices?.length) notes.push(`It speaks with the voice ${report.voices.join(', ')}, which this machine needs.`);
  if (notes.length) alert(`Loaded "${report.name}".\n\n${notes.join('\n')}`);
}

/** @param {() => string | null} currentAgent the agent whose panel is open */
export function initAgentTransfer(currentAgent) {
  const withLogins = () => document.getElementById('agent-transfer-credentials').checked;
  const run = (fn) => async () => {
    const agent = currentAgent();
    if (!agent) return;
    try { await fn(agent); } catch (err) { setStatus(err.message, true); }
  };
  document.getElementById('agent-duplicate-btn').addEventListener('click', run(duplicate));
  document.getElementById('agent-save-btn').addEventListener('click', run(a => saveToFile(a, withLogins())));
  document.getElementById('agent-send-btn').addEventListener('click', run(a => sendToRunner(a, withLogins())));
  document.getElementById('agent-to-library-btn').addEventListener('click', run(addToLibrary));
  try { document.getElementById('agent-send-url').value = localStorage.getItem(SEND_URL_KEY) ?? ''; } catch { /* none kept */ }

  const input = document.getElementById('load-agent-input');
  document.getElementById('load-agent-btn').addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (file) await loadFromFile(file).catch(err => alert(`Could not load the agent: ${err.message}`));
  });
}

/** Clear what the last agent's panel said. */
export function resetAgentTransfer() {
  setStatus('');
  const key = document.getElementById('agent-send-key');
  if (key) key.value = '';
}
