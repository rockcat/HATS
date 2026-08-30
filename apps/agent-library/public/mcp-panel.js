/**
 * Per-agent MCP configuration for the template editor.
 *
 * Mirrors the dashboard's personal-MCP panel. Credentials are stored on the
 * server in a runner-local sidecar, never in the template document, and secret
 * fields come back masked — resubmitting the mask leaves the stored value alone.
 */

import { $, clear, el, guard, makeClient, toastOk } from '/ui-kit/hats-ui.js';

const api = makeClient('/api/v1');
const SECRET_PLACEHOLDER = '__stored__';
const SECRET_NAME = /PASSWORD|TOKEN|SECRET|_KEY$|APIKEY|API_KEY|CREDENTIAL/i;
const FEATURE_VAR = /FEATURE_OVERRIDES$/;

let catalogue = { personal: [], shared: [] };
let templateId = null;

export async function loadMcpCatalogue() {
  catalogue = (await api.get('/mcp/catalogue')) ?? { personal: [], shared: [] };
  return catalogue;
}

/** "a:on,b:off" → { a: true, b: false } */
function parseFeatureOverrides(value) {
  const out = {};
  for (const part of (value ?? '').split(',')) {
    const [k, v] = part.split(':');
    if (k && v) out[k.trim()] = v.trim() === 'on';
  }
  return out;
}

function serialiseFeatureOverrides(entries) {
  return entries.filter(({ input, defaultOn }) => input.checked !== defaultOn)
    .map(({ key, input }) => `${key}:${input.checked ? 'on' : 'off'}`)
    .join(',');
}

// ── Rendering ────────────────────────────────────────────────────────────────

function buildServerCard(entry, state) {
  const values = state?.values ?? {};
  const configured = Boolean(state?.configured);
  const inputs = new Map();
  const featureEntries = [];

  const fields = el('div', { class: 'mcp-fields' });
  for (const v of entry.envVars ?? []) {
    // A FEATURE_OVERRIDES var is a checkbox grid, not a text field.
    if (FEATURE_VAR.test(v.name)) {
      const current = parseFeatureOverrides(values[v.name]);
      const known = Object.keys(current);
      if (known.length === 0) known.push('gmail', 'calendar', 'drive', 'docs', 'sheets', 'chat');
      const grid = el('div', { class: 'mcp-feature-grid' });
      for (const key of known) {
        const input = el('input', { type: 'checkbox' });
        input.checked = current[key] ?? true;
        featureEntries.push({ key, input, defaultOn: true });
        grid.append(el('label', { class: 'mcp-feature' }, input, key));
      }
      fields.append(el('div', { class: 'mcp-field' },
        el('span', { class: 'mcp-field-label' }, 'Features'), grid));
      inputs.set(v.name, { feature: true });
      continue;
    }

    const secret = SECRET_NAME.test(v.name);
    const input = el('input', {
      type: secret ? 'password' : 'text',
      value: values[v.name] ?? '',
      placeholder: v.placeholder ?? v.name,
      autocomplete: 'off',
    });
    inputs.set(v.name, { input, secret });
    fields.append(el('div', { class: 'mcp-field' },
      el('span', { class: 'mcp-field-label', title: v.name }, v.name),
      input));
  }

  const status = el('span', { class: `tag ${configured ? (state.disabled ? 'warn' : 'ok') : ''}` },
    configured ? (state.disabled ? 'stopped' : 'configured') : 'not set up');

  const save = el('button', { class: 'primary small' }, 'Save');
  save.addEventListener('click', () => void guard(async () => {
    const payload = {};
    for (const [name, spec] of inputs) {
      if (spec.feature) { payload[name] = serialiseFeatureOverrides(featureEntries); continue; }
      // An untouched secret still holds the mask, which means "keep stored".
      payload[name] = spec.input.value;
    }
    await api.put(`/agent-templates/${templateId}/personal-mcp/${encodeURIComponent(entry.id)}`, { values: payload });
    await refresh();
  }, `${entry.name} saved`));

  const remove = configured
    ? el('button', { class: 'small danger' }, 'Remove')
    : null;
  remove?.addEventListener('click', () => void guard(async () => {
    if (!confirm(`Remove ${entry.name} credentials for this agent?`)) return;
    await api.delete(`/agent-templates/${templateId}/personal-mcp/${encodeURIComponent(entry.id)}`);
    await refresh();
  }, `${entry.name} removed`));

  const body = el('div', { class: 'mcp-body', hidden: !configured },
    fields,
    el('div', { class: 'mcp-actions' }, save, remove),
  );

  const toggle = el('button', { class: 'ghost small' }, configured ? 'Edit' : 'Set up');
  toggle.addEventListener('click', () => {
    body.hidden = !body.hidden;
    toggle.textContent = body.hidden ? (configured ? 'Edit' : 'Set up') : 'Close';
  });

  return el('div', { class: 'mcp-card' },
    el('div', { class: 'mcp-head' },
      el('span', { class: 'grow' },
        el('div', { class: 'name' }, entry.name),
        el('div', { class: 'meta' }, entry.description ?? ''),
      ),
      status,
      entry.url ? el('a', { class: 'btn small', href: entry.url, target: '_blank', rel: 'noopener' }, 'Docs') : null,
      toggle,
    ),
    body,
  );
}

async function refresh() {
  const list = $('#mcp-list');
  if (!templateId) { clear(list); return; }

  const result = await api.get(`/agent-templates/${templateId}/personal-mcp`);
  const byId = new Map((result?.servers ?? []).map((s) => [s.id, s]));

  clear(list);
  for (const entry of catalogue.personal) list.append(buildServerCard(entry, byId.get(entry.id)));

  const count = [...byId.values()].filter((s) => !s.disabled).length;
  $('#mcp-count').textContent = String(count);
}

/** Point the panel at a template. Pass null to clear it. */
export async function showMcpFor(id) {
  templateId = id;
  $('#mcp-empty').hidden = Boolean(id);
  $('#mcp-list').hidden = !id;
  if (!id) { clear($('#mcp-list')); $('#mcp-count').textContent = '0'; return; }
  await guard(() => refresh());
}

export { SECRET_PLACEHOLDER };
