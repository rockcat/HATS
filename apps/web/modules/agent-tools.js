// ── Which tools this project's agent is sent in every call ─────────────────────
//
// Every tool an agent can reach is either sent with each request, where it
// costs its schema every time, or found with search_tools when wanted. The
// hat's own tools and the board's hot path are always sent. The MCP tools are
// ticked in or out here, for this project's copy only; the template keeps its
// own choice. Totals update as boxes change, before anything is saved.

import { esc } from './utils.js';

let _name = null;
let _rows = [];
let _dirty = false;
let _useDefault = false;

const el = id => document.getElementById(id);
const tokens = chars => Math.round(chars / 4);
const fmt = n => `~${n.toLocaleString()}`;
const bare = row => row.server ? row.name.slice(`mcp__${row.server}__`.length) : row.name;

/** Totals for a set of rows, as the summary line shows them. */
export function toolTotals(rows) {
  const sent = rows.filter(r => r.upfront);
  return {
    sent: sent.length,
    sentTokens: tokens(sent.reduce((n, r) => n + r.chars, 0)),
    searched: rows.length - sent.length,
  };
}

/** Rows grouped for display: the fixed ones first, then a group per server. */
export function toolGroups(rows) {
  const groups = [{ key: 'fixed', label: 'Always sent', rows: rows.filter(r => !r.selectable) }];
  const byServer = new Map();
  for (const r of rows.filter(r => r.selectable)) {
    const key = r.server ?? 'runner';
    if (!byServer.has(key)) byServer.set(key, []);
    byServer.get(key).push(r);
  }
  for (const [key, list] of byServer) groups.push({ key, label: key === 'runner' ? 'Runner tools' : key, rows: list });
  return groups.filter(g => g.rows.length > 0);
}

function renderSummary() {
  const sum = el('agent-tools-summary');
  if (!sum) return;
  const t = toolTotals(_rows);
  sum.textContent = _rows.length
    ? `Tools: ${t.sent} sent each call (${fmt(t.sentTokens)} tokens), ${t.searched} by search${_useDefault ? ', default' : ''}`
    : 'Tools';
}

function render() {
  const list = el('agent-tools-list');
  if (!list) return;
  if (!_rows.length) {
    list.innerHTML = '<div class="agent-tools-empty">No tools yet. MCP servers may still be starting.</div>';
    renderSummary();
    return;
  }
  list.innerHTML = toolGroups(_rows).map(g => {
    const selectable = g.key !== 'fixed';
    const on = g.rows.filter(r => r.upfront).length;
    const groupTokens = tokens(g.rows.filter(r => r.upfront).reduce((n, r) => n + r.chars, 0));
    const head = selectable
      ? `<label class="agent-tools-group-head"><input type="checkbox" data-group="${esc(g.key)}"${on === g.rows.length ? ' checked' : ''}${on > 0 && on < g.rows.length ? ' data-partial="1"' : ''}>`
        + `<span class="agent-tools-group-name">${esc(g.label)}</span><span class="agent-tools-meta">${on}/${g.rows.length} · ${fmt(groupTokens)}</span></label>`
      : `<div class="agent-tools-group-head"><span class="agent-tools-group-name">${esc(g.label)}</span><span class="agent-tools-meta">${g.rows.length} · ${fmt(groupTokens)}</span></div>`;
    const rows = g.rows.map(r => `
      <label class="agent-tools-row" title="${esc(r.description)}">
        <input type="checkbox" data-tool="${esc(r.name)}"${r.upfront ? ' checked' : ''}${r.selectable ? '' : ' disabled'}>
        <span class="agent-tools-name">${esc(bare(r))}</span>
        <span class="agent-tools-meta">${fmt(tokens(r.chars))}</span>
      </label>`).join('');
    return `<div class="agent-tools-group">${head}${rows}</div>`;
  }).join('');
  list.querySelectorAll('input[data-partial]').forEach(cb => { cb.indeterminate = true; });
  renderSummary();
}

async function load(asDefault = false) {
  const name = _name;
  try {
    const data = await fetch(`/api/agents/${encodeURIComponent(name)}/tools${asDefault ? '?default=1' : ''}`).then(r => r.json());
    if (name !== _name) return; // another agent was opened meanwhile
    _rows = data.rows ?? [];
    if (!asDefault) _useDefault = !data.custom;
  } catch {
    _rows = [];
  }
  render();
}

function onChange(e) {
  const target = e.target;
  if (target.dataset.tool) {
    const row = _rows.find(r => r.name === target.dataset.tool);
    if (row?.selectable) row.upfront = target.checked;
  } else if (target.dataset.group) {
    for (const r of _rows) if (r.selectable && (r.server ?? 'runner') === target.dataset.group) r.upfront = target.checked;
  } else {
    return;
  }
  _dirty = true;
  _useDefault = false;
  const list = el('agent-tools-list');
  const scroll = list.scrollTop;
  render();
  list.scrollTop = scroll;
}

/** Show this agent's tools. */
export function bindAgentTools(name) {
  _name = name;
  _rows = [];
  _dirty = false;
  _useDefault = false;
  render();
  load();
}

/** Wire the inputs once; called from initAgentDetail. */
export function initAgentTools() {
  el('agent-tools-list')?.addEventListener('change', onChange);
  el('agent-tools-default')?.addEventListener('click', async () => {
    _dirty = true;
    _useDefault = true;
    await load(true);
  });
}

/** Save the choice, if it changed; part of the Configure panel's Apply. */
export async function saveAgentTools(name) {
  if (!_dirty || name !== _name) return;
  const upfront = _useDefault ? null : _rows.filter(r => r.selectable && r.upfront).map(r => r.name);
  const r = await fetch(`/api/agents/${encodeURIComponent(name)}/tools`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ upfront }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Could not save the tools');
  _dirty = false;
}
