/**
 * A visible record of every Embodiment API call the harness makes.
 * The point of this app is to prove the API, so the traffic is the output.
 */

import { $, el } from '/ui-kit/hats-ui.js';

const MAX_ENTRIES = 200;

function append(node) {
  const log = $('#wire-log');
  log.prepend(node);
  while (log.childElementCount > MAX_ENTRIES) log.lastElementChild.remove();
}

export function logRequest(method, path, status) {
  const ok = status >= 200 && status < 400;
  append(el('div', { class: `wire-entry ${ok ? 'ok' : 'err'}` },
    el('span', { class: 'verb' }, method),
    el('span', { class: 'path' }, path),
    el('span', { class: 'code' }, String(status)),
  ));
}

export function logEvent(type, detail) {
  append(el('div', { class: 'wire-entry sse' },
    el('span', { class: 'verb' }, 'SSE'),
    el('span', { class: 'path' }, detail ? `${type} — ${detail}` : type),
  ));
}

export function clearLog() {
  $('#wire-log').replaceChildren();
}

/** fetch wrapper that records the call and parses JSON. */
export async function call(method, path, body) {
  const init = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(path, init);
  logRequest(method, path.replace('/runner/api/embodiment/v1', ''), response.status);
  if (response.status === 204) return null;

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.startsWith('audio/')) return response.blob();

  const text = await response.text();
  const parsed = text ? safeParse(text) : null;
  if (!response.ok) throw new Error(parsed?.error ?? `HTTP ${response.status}`);
  return parsed;
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { return { raw: text }; }
}
