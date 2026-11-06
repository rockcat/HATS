// ── Every model the providers returned, with its price ────────────────────────
//
// Opened from Settings beside "Update pricing", so the effect of a refresh can
// be seen: which models are priced, which are free, which are unknown.

import { esc } from './utils.js';

const el = id => document.getElementById(id);

/**
 * One row per provider model, sorted by provider then model.
 * `price` is null when the pricing table has no entry and the provider is not free.
 */
export function catalogueRows(providers, liveModels, { pricing = {}, freeProviders = [], contextWindows = {} } = {}) {
  const live = new Map((liveModels ?? []).map(l => [l.id, l.models ?? []]));
  const rows = [];
  for (const p of providers ?? []) {
    const models = live.get(p.id)?.length ? live.get(p.id) : (p.models ?? []);
    const free   = freeProviders.includes(p.id);
    for (const model of [...new Set(models)].sort()) {
      rows.push({
        provider: p.label ?? p.id, providerId: p.id, available: !!p.available, model,
        free, price: free ? null : (pricing[model] ?? null),
        context: contextWindows[model] ?? null,
      });
    }
  }
  return rows;
}

/** Models with a price that no provider offered — kept so stale entries can be spotted. */
export function pricedButUnoffered(rows, pricing = {}) {
  const offered = new Set(rows.map(r => r.model));
  return Object.keys(pricing).filter(m => !offered.has(m)).sort()
    .map(model => ({ model, price: pricing[model] }));
}

/** Keep rows whose provider or model contains the text. */
export function filterRows(rows, text) {
  const q = String(text ?? '').trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(r => r.model.toLowerCase().includes(q) || r.provider.toLowerCase().includes(q));
}

const money = n => `$${Number(n).toFixed(2)}`;

function priceCells(row) {
  if (row.free)   return '<td colspan="2" class="model-cat-free">Free (local)</td>';
  if (!row.price) return '<td colspan="2" class="model-cat-unknown">Unknown</td>';
  return `<td>${money(row.price.input)}</td><td>${money(row.price.output)}</td>`;
}

function rowHTML(row) {
  const dot = row.available ? '🟢' : '🔴';
  return `<tr>
    <td title="${row.available ? 'Available' : 'Not configured or offline'}">${dot} ${esc(row.provider)}</td>
    <td class="model-cat-model">${esc(row.model)}</td>
    ${priceCells(row)}
    <td>${row.context ? row.context.toLocaleString() : '—'}</td>
  </tr>`;
}

let rows = [];
let unoffered = [];

function render() {
  const shown = filterRows(rows, el('model-cat-filter').value);
  const unknown = rows.filter(r => !r.free && !r.price).length;
  el('model-cat-summary').textContent =
    `${rows.length} models · ${rows.length - unknown} priced or free · ${unknown} unknown`;
  el('model-cat-rows').innerHTML = shown.length
    ? shown.map(rowHTML).join('')
    : '<tr><td colspan="5" class="model-cat-empty">No models match</td></tr>';

  const extra = el('model-cat-unoffered');
  extra.hidden = unoffered.length === 0;
  extra.querySelector('ul').innerHTML = unoffered
    .map(u => `<li><span class="model-cat-model">${esc(u.model)}</span> ${money(u.price.input)} / ${money(u.price.output)}</li>`)
    .join('');
}

export async function openModelCatalogue() {
  el('model-cat-modal').hidden = false;
  el('model-cat-summary').textContent = 'Loading…';
  el('model-cat-rows').innerHTML = '';
  try {
    const [providers, liveModels, pricing] = await Promise.all([
      fetch('/api/providers').then(r => r.json()),
      fetch('/api/providers/models').then(r => r.json()),
      fetch('/api/pricing').then(r => r.json()),
    ]);
    rows = catalogueRows(providers, liveModels, pricing);
    unoffered = pricedButUnoffered(rows, pricing.pricing);
    render();
  } catch (err) {
    el('model-cat-summary').textContent = `Could not load the models: ${err.message}`;
  }
}

function close() { el('model-cat-modal').hidden = true; }

let inited = false;

export function initModelCatalogue() {
  if (inited) return;
  inited = true;
  el('model-cat-close').addEventListener('click', close);
  el('model-cat-modal').addEventListener('click', e => { if (e.target.id === 'model-cat-modal') close(); });
  el('model-cat-filter').addEventListener('input', render);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !el('model-cat-modal').hidden) { e.stopPropagation(); close(); }
  }, true);
}
