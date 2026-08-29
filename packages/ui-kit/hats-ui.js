/**
 * Shared browser helpers for the HATS front-ends.
 * No build step, no framework — plain ES modules loaded straight from /ui-kit.
 */

export const HAT_TYPES = ['none', 'white', 'red', 'black', 'yellow', 'green', 'blue'];

// ── DOM ──────────────────────────────────────────────────────────────────────

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/** Build an element: el('div', { class: 'x' }, 'text', childEl). */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function hatDot(hat) {
  return el('span', { class: `hat hat-${hat}`, title: `${hat} hat` });
}

export function hatDots(hats = []) {
  return (hats.length ? hats : ['none']).map(hatDot);
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(status, body) {
    const detail = body?.details?.map((d) => `${d.path} ${d.message}`).join(', ');
    super(body?.error ? `${body.error}${detail ? ` (${detail})` : ''}` : `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

/** fetch + JSON + uniform errors. Returns null for 204. */
export async function api(url, options = {}) {
  const init = { ...options, headers: { ...(options.headers ?? {}) } };
  if (init.body !== undefined && typeof init.body !== 'string') {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(init.body);
  }
  const response = await fetch(url, init);
  if (response.status === 204) return null;
  const text = await response.text();
  const body = text ? safeParse(text) : null;
  if (!response.ok) throw new ApiError(response.status, body);
  return body;
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

/** A base-url-bound API client: client.get('/agents'), client.post('/agents', body). */
export function makeClient(baseUrl) {
  const join = (path) => `${baseUrl.replace(/\/$/, '')}${path}`;
  return {
    baseUrl,
    get:    (path) => api(join(path)),
    post:   (path, body) => api(join(path), { method: 'POST', body }),
    put:    (path, body) => api(join(path), { method: 'PUT', body }),
    patch:  (path, body) => api(join(path), { method: 'PATCH', body }),
    delete: (path) => api(join(path), { method: 'DELETE' }),
    url:    join,
  };
}

// ── Toasts ───────────────────────────────────────────────────────────────────

function toastStack() {
  let stack = document.getElementById('toast-stack');
  if (!stack) {
    stack = el('div', { id: 'toast-stack' });
    document.body.append(stack);
  }
  return stack;
}

export function toast(message, kind = '', ms = 4000) {
  const node = el('div', { class: `toast ${kind}` }, message);
  toastStack().append(node);
  setTimeout(() => node.remove(), ms);
  return node;
}

export const toastOk = (message) => toast(message, 'ok', 2500);
export const toastError = (error) => toast(error?.message ?? String(error), 'error', 6000);

/** Run an async action, reporting failure as a toast rather than an unhandled rejection. */
export async function guard(action, successMessage) {
  try {
    const result = await action();
    if (successMessage) toastOk(successMessage);
    return result;
  } catch (err) {
    toastError(err);
    return undefined;
  }
}

// ── Misc ─────────────────────────────────────────────────────────────────────

export function debounce(fn, ms = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function relativeTime(iso) {
  if (!iso) return '';
  const delta = Date.now() - new Date(iso).getTime();
  const units = [[86400000, 'd'], [3600000, 'h'], [60000, 'm']];
  for (const [ms, suffix] of units) {
    if (delta >= ms) return `${Math.floor(delta / ms)}${suffix} ago`;
  }
  return 'just now';
}

/** Poll a health endpoint and reflect it in a status dot + label. */
export function trackHealth(dot, label, url, intervalMs = 15000) {
  const check = async () => {
    try {
      const health = await api(url);
      dot.className = 'status-dot online';
      if (label) label.textContent = health?.service ?? 'online';
    } catch {
      dot.className = 'status-dot offline';
      if (label) label.textContent = 'offline';
    }
  };
  check();
  const timer = setInterval(check, intervalMs);
  return () => clearInterval(timer);
}
