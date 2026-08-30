// ── MCP Catalogue (view + editor) ─────────────────────────────────────────────

import { esc } from './utils.js';

// ── Shared helpers used by both view and editor ───────────────────────────────

export function parseFeatureOverrides(val) {
  const result = {};
  if (!val) return result;
  for (const part of val.split(',')) {
    const [k, v] = part.split(':');
    if (k && v) result[k.trim()] = v.trim() === 'on';
  }
  return result;
}

export function serializeFeatureOverrides(checksMap) {
  const parts = [];
  for (const [key, { cb, defaultOn }] of Object.entries(checksMap)) {
    if (cb.checked !== defaultOn) parts.push(`${key}:${cb.checked ? 'on' : 'off'}`);
  }
  return parts.join(',');
}

// ── Category colours ──────────────────────────────────────────────────────────

const CATEGORY_COLOR = {
  productivity: { bg: 'rgba(88,166,255,0.12)',  text: '#58a6ff' },
  files:        { bg: 'rgba(63,185,80,0.12)',   text: '#3fb950' },
  web:          { bg: 'rgba(227,179,65,0.12)',  text: '#e3b341' },
  data:         { bg: 'rgba(248,81,73,0.12)',   text: '#f85149' },
  dev:          { bg: 'rgba(139,148,158,0.12)', text: '#8b949e' },
};

// ── MCP Catalogue view ────────────────────────────────────────────────────────

function renderMCPCatalogue(catalogue, googleStatus = { authenticated: false }) {
  const el = document.getElementById('mcp-content');
  if (!el) return;

  const sharedCatalogue   = catalogue.filter(e => e.users?.includes('human'));
  const personalCatalogue = catalogue.filter(e => e.users?.includes('agent'));
  const categories        = [...new Set(sharedCatalogue.map(e => e.category))];
  let html = '';

  const hasGoogleHttpMcps = sharedCatalogue.some(e =>
    ['google-gmail','google-calendar','google-drive','google-chat','google-contacts'].includes(e.id));
  if (hasGoogleHttpMcps) {
    if (googleStatus.authenticated) {
      html += `<div class="mcp-google-auth-banner connected">
        <span class="mcp-google-auth-icon">✓</span>
        <span>Google Account connected</span>
        <button class="mcp-google-auth-btn disconnect" onclick="disconnectGoogle()">Disconnect</button>
      </div>`;
    } else {
      html += `<div class="mcp-google-auth-banner">
        <span class="mcp-google-auth-icon">⚠</span>
        <span>Connect your Google Account to use Gmail, Calendar, Drive, Chat, and Contacts MCPs</span>
        <button class="mcp-google-auth-btn" onclick="openGoogleAuthPopup()">Connect Google</button>
      </div>`;
    }
  }

  if (personalCatalogue.length > 0) {
    html += `<div class="mcp-personal-note">
      <span class="mcp-personal-note-icon">👤</span>
      <span><strong>Personal MCPs</strong> (${personalCatalogue.map(e => e.name).join(', ')}) are configured per-agent with individual credentials — open an agent's detail panel to set them up.</span>
    </div>`;
  }

  for (const cat of categories) {
    const entries = sharedCatalogue.filter(e => e.category === cat);
    const cc = CATEGORY_COLOR[cat] || CATEGORY_COLOR.dev;
    html += `<div class="mcp-cat-label" style="color:${cc.text}">${esc(cat)}</div>`;
    for (const entry of entries) {
      const envHtml = (entry.envStatus ?? []).map(v =>
        `<span class="mcp-env-badge ${v.present ? 'present' : 'missing'}" title="${v.present ? 'Set' : 'Not set'}">${esc(v.name)}</span>`
      ).join('');
      const catBadge = `<span class="mcp-cat-badge" style="background:${cc.bg};color:${cc.text}">${esc(cat)}</span>`;
      const linkHtml = entry.url
        ? `<a class="mcp-entry-link" href="${esc(entry.url)}" target="_blank" rel="noopener noreferrer" title="Setup docs ↗">docs ↗</a>`
        : '';
      html += `
        <div class="mcp-entry ${entry.enabled ? 'enabled' : ''}" data-id="${esc(entry.id)}">
          <div class="mcp-entry-main">
            <div class="mcp-entry-title">
              <span class="mcp-entry-name">${esc(entry.name)}</span>
              ${catBadge}${envHtml}${linkHtml}
            </div>
            <div class="mcp-entry-desc">${esc(entry.description)}</div>
          </div>
          <button class="mcp-toggle ${entry.enabled ? 'on' : 'off'}" data-id="${esc(entry.id)}" title="${entry.enabled ? 'Disable' : 'Enable'}">
            <span class="mcp-toggle-knob"></span>
          </button>
        </div>`;
    }
  }

  el.innerHTML = html || '<p class="tools-empty">No servers in catalogue</p>';
  el.querySelectorAll('.mcp-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      toggleMCP(btn.dataset.id, btn.classList.contains('off'), btn);
    });
  });
}

function toggleMCP(id, enable, btn) {
  const wasOn = !enable;
  btn.disabled = true;
  btn.classList.add('loading');
  btn.classList.toggle('on', enable);
  btn.classList.toggle('off', !enable);
  const entry = btn.closest('.mcp-entry');
  if (entry) entry.querySelector('.mcp-entry-error')?.remove();

  const url = enable ? '/api/mcp/enable' : '/api/mcp/disable';
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
    .then(r => r.json())
    .then(result => {
      if (result.error) {
        btn.classList.toggle('on', wasOn);
        btn.classList.toggle('off', !wasOn);
        if (entry) {
          const errEl = document.createElement('div');
          errEl.className = 'mcp-entry-error';
          errEl.textContent = result.error;
          entry.querySelector('.mcp-entry-main')?.appendChild(errEl);
        }
      } else {
        fetchMCPCatalogue();
      }
    })
    .catch(err => {
      btn.classList.toggle('on', wasOn);
      btn.classList.toggle('off', !wasOn);
      if (entry) {
        const errEl = document.createElement('div');
        errEl.className = 'mcp-entry-error';
        errEl.textContent = String(err);
        entry.querySelector('.mcp-entry-main')?.appendChild(errEl);
      }
    })
    .finally(() => {
      btn.disabled = false;
      btn.classList.remove('loading');
    });
}

export function fetchMCPCatalogue() {
  Promise.all([
    fetch('/api/mcp/catalogue').then(r => r.json()),
    fetch('/api/auth/google/status').then(r => r.json()).catch(() => ({ authenticated: false })),
  ])
    .then(([catalogue, googleStatus]) => renderMCPCatalogue(catalogue, googleStatus))
    .catch(() => {});
}

function openGoogleAuthPopup() {
  const popup = window.open('/api/auth/google/start', 'google-auth', 'width=600,height=700,scrollbars=yes');
  window.addEventListener('message', function onMsg(e) {
    if (e.data?.type === 'google-auth-success') {
      window.removeEventListener('message', onMsg);
      popup?.close();
      fetchMCPCatalogue();
    } else if (e.data?.type === 'google-auth-error') {
      window.removeEventListener('message', onMsg);
      popup?.close();
      alert('Google authentication failed: ' + (e.data.error || 'unknown error'));
    }
  });
}

function disconnectGoogle() {
  fetch('/api/auth/google', { method: 'DELETE' })
    .then(() => fetchMCPCatalogue())
    .catch(() => {});
}

// Expose for inline onclick in rendered HTML
window.openGoogleAuthPopup = openGoogleAuthPopup;
window.disconnectGoogle    = disconnectGoogle;

// ── MCP Catalogue Editor ──────────────────────────────────────────────────────

let _mcpEditorSelected     = null;
let _mcpEditorCurrentEntry = null;
let _mcpEditorFeatureGetter = () => ({});

function openMCPEditor() {
  _mcpEditorSelected = null;
  fetchAndRenderEditorList();
  clearEditorForm();
  document.getElementById('mcp-editor-modal').hidden = false;
}

function closeMCPEditor() {
  document.getElementById('mcp-editor-modal').hidden = true;
}

async function fetchAndRenderEditorList() {
  const listEl = document.getElementById('mcp-editor-list');
  listEl.innerHTML = '<p class="mcp-editor-loading">Loading…</p>';
  try {
    const raw = await fetch('/api/mcp/catalogue').then(r => r.json());
    renderEditorList(raw);
  } catch {
    listEl.innerHTML = '<p class="mcp-editor-loading">Failed to load.</p>';
  }
}

function renderEditorList(entries) {
  const listEl  = document.getElementById('mcp-editor-list');
  const grouped = {};
  for (const e of entries) {
    if (!grouped[e.category]) grouped[e.category] = [];
    grouped[e.category].push(e);
  }
  let html = '';
  for (const [cat, items] of Object.entries(grouped)) {
    const cc = CATEGORY_COLOR[cat] || CATEGORY_COLOR.dev;
    html += `<div class="mcp-editor-cat-label" style="color:${cc.text}">${esc(cat)}</div>`;
    for (const item of items) {
      html += `<button class="mcp-editor-item${_mcpEditorSelected === item.id ? ' selected' : ''}" data-id="${esc(item.id)}">${esc(item.name)}</button>`;
    }
  }
  listEl.innerHTML = html || '<p class="mcp-editor-loading">No entries</p>';
  listEl.querySelectorAll('.mcp-editor-item').forEach(btn => {
    btn.addEventListener('click', () => selectEditorEntry(btn.dataset.id, entries));
  });
}

function clearEditorForm() {
  document.getElementById('mcp-editor-placeholder').hidden = false;
  document.getElementById('mcp-editor-fields').hidden      = true;
  document.getElementById('mcp-ef-error').textContent      = '';
  _mcpEditorSelected = null;
}

function selectEditorEntry(id, entries) {
  _mcpEditorSelected = id;
  const entry = entries.find(e => e.id === id);
  if (!entry) return;
  _mcpEditorCurrentEntry = entry;

  document.getElementById('mcp-editor-placeholder').hidden = true;
  document.getElementById('mcp-editor-fields').hidden      = false;
  document.getElementById('mcp-ef-error').textContent      = '';

  document.getElementById('mcp-ef-id').value          = entry.id;
  document.getElementById('mcp-ef-id').readOnly        = true;
  document.getElementById('mcp-ef-name').value         = entry.name || '';
  document.getElementById('mcp-ef-description').value  = entry.description || '';
  document.getElementById('mcp-ef-category').value     = entry.category || 'productivity';
  document.getElementById('mcp-ef-notes').value        = entry.notes || '';
  document.getElementById('mcp-ef-docs-url').value     = entry.url || '';
  document.getElementById('mcp-ef-users-human').checked = !!entry.users?.includes('human');
  document.getElementById('mcp-ef-users-agent').checked = !!entry.users?.includes('agent');

  const transport = entry.config?.transport || 'stdio';
  document.getElementById('mcp-ef-transport').value = transport;
  toggleTransportFields(transport);

  if (transport === 'stdio') {
    document.getElementById('mcp-ef-command').value = entry.config.command || '';
    document.getElementById('mcp-ef-args').value    = (entry.config.args || []).join('\n');
    const nonFeatureVars = (entry.envVars || []).filter(v => (typeof v === 'string' || v.type !== 'features'));
    document.getElementById('mcp-ef-envvars').value = nonFeatureVars.map(v => typeof v === 'string' ? v : v.name).join('\n');
  } else {
    document.getElementById('mcp-ef-url-endpoint').value = entry.config.url || '';
    const headers = entry.config.headers ?? {};
    document.getElementById('mcp-ef-headers').value =
      Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\n');
  }

  populateEditorFeatures(entry);
  document.querySelectorAll('.mcp-editor-item').forEach(b => b.classList.toggle('selected', b.dataset.id === id));
}

function populateEditorFeatures(entry) {
  const container = document.getElementById('mcp-ef-features-container');
  container.innerHTML = '';
  container.hidden    = true;
  _mcpEditorFeatureGetter = () => ({});

  const featureVars = (entry?.envVars || []).filter(v => typeof v === 'object' && v.type === 'features');
  if (!featureVars.length) return;

  container.hidden = false;
  const allChecks  = {};

  for (const varDef of featureVars) {
    const currentVal = entry.config?.env?.[varDef.name] ?? '';
    const overrides  = parseFeatureOverrides(currentVal);

    const section = document.createElement('div');
    section.className = 'mcp-ef-group personal-mcp-features-section';

    const label = document.createElement('label');
    label.className  = 'mcp-ef-label';
    label.textContent = varDef.name;
    section.appendChild(label);

    const grid = document.createElement('div');
    grid.className   = 'personal-mcp-features-grid';

    const checksMap = {};
    for (const feat of (varDef.features || [])) {
      const isOn = feat.key in overrides ? overrides[feat.key] : feat.defaultOn;
      const item = document.createElement('label');
      item.className = 'personal-mcp-feature-item';
      const cb   = document.createElement('input');
      cb.type    = 'checkbox';
      cb.checked = isOn;
      item.appendChild(cb);
      item.appendChild(document.createTextNode(feat.label));
      grid.appendChild(item);
      checksMap[feat.key] = { cb, defaultOn: feat.defaultOn };
    }
    section.appendChild(grid);
    container.appendChild(section);
    allChecks[varDef.name] = { checksMap };
  }

  _mcpEditorFeatureGetter = () => {
    const result = {};
    for (const [varName, { checksMap }] of Object.entries(allChecks)) {
      result[varName] = serializeFeatureOverrides(checksMap);
    }
    return result;
  };
}

function toggleTransportFields(transport) {
  document.getElementById('mcp-ef-stdio-fields').hidden  = transport !== 'stdio';
  document.getElementById('mcp-ef-url-fields').hidden    = transport === 'stdio';
  document.getElementById('mcp-ef-headers-group').hidden = transport !== 'http';
}

function buildEntryFromForm() {
  const transport    = document.getElementById('mcp-ef-transport').value;
  const envVarNames  = document.getElementById('mcp-ef-envvars').value
    .split('\n').map(s => s.trim()).filter(Boolean);

  const featureEnvValues = _mcpEditorFeatureGetter();
  const featureVarNames  = Object.keys(featureEnvValues);

  const config = transport === 'stdio'
    ? {
        transport: 'stdio',
        command: document.getElementById('mcp-ef-command').value.trim(),
        args: document.getElementById('mcp-ef-args').value
          .split('\n').map(s => s.trim()).filter(Boolean),
        ...((envVarNames.length > 0 || featureVarNames.length > 0)
          ? { env: {
                ...Object.fromEntries(envVarNames.map(k => [k, ''])),
                ...Object.fromEntries(featureVarNames.map(k => [k, featureEnvValues[k]])),
              } }
          : {}),
      }
    : (() => {
        const cfg = { transport, url: document.getElementById('mcp-ef-url-endpoint').value.trim() };
        if (transport === 'http') {
          const headerLines = document.getElementById('mcp-ef-headers').value
            .split('\n').map(s => s.trim()).filter(Boolean);
          const headers = Object.fromEntries(
            headerLines
              .map(line => { const i = line.indexOf(':'); return [line.slice(0, i).trim(), line.slice(i + 1).trim()]; })
              .filter(([k]) => k),
          );
          if (Object.keys(headers).length) cfg.headers = headers;
        }
        return cfg;
      })();

  const preservedFeatureVarDefs = (_mcpEditorCurrentEntry?.envVars || [])
    .filter(v => typeof v === 'object' && v.type === 'features' && featureVarNames.includes(v.name));
  const allEnvVars = [...envVarNames, ...preservedFeatureVarDefs];

  const users = [];
  if (document.getElementById('mcp-ef-users-human').checked) users.push('human');
  if (document.getElementById('mcp-ef-users-agent').checked) users.push('agent');

  return {
    id:          document.getElementById('mcp-ef-id').value.trim(),
    name:        document.getElementById('mcp-ef-name').value.trim(),
    description: document.getElementById('mcp-ef-description').value.trim(),
    category:    document.getElementById('mcp-ef-category').value,
    config,
    ...(allEnvVars.length > 0 ? { envVars: allEnvVars } : {}),
    users,
    notes:   document.getElementById('mcp-ef-notes').value.trim() || undefined,
    url:     document.getElementById('mcp-ef-docs-url').value.trim() || undefined,
  };
}

export function initMCPEditor() {
  document.getElementById('mcp-catalogue-edit-btn').addEventListener('click', openMCPEditor);
  document.getElementById('mcp-editor-close').addEventListener('click', closeMCPEditor);
  document.getElementById('mcp-editor-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('mcp-editor-modal')) closeMCPEditor();
  });

  document.getElementById('mcp-editor-add-btn').addEventListener('click', () => {
    _mcpEditorSelected = null;
    document.getElementById('mcp-editor-placeholder').hidden = true;
    document.getElementById('mcp-editor-fields').hidden      = false;
    document.getElementById('mcp-ef-error').textContent      = '';
    ['mcp-ef-id','mcp-ef-name','mcp-ef-description','mcp-ef-notes','mcp-ef-docs-url',
     'mcp-ef-command','mcp-ef-args','mcp-ef-envvars','mcp-ef-url-endpoint','mcp-ef-headers'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('mcp-ef-id').readOnly           = false;
    document.getElementById('mcp-ef-users-human').checked   = true;
    document.getElementById('mcp-ef-users-agent').checked   = false;
    document.getElementById('mcp-ef-transport').value       = 'stdio';
    document.getElementById('mcp-ef-category').value        = 'productivity';
    toggleTransportFields('stdio');
    const fc = document.getElementById('mcp-ef-features-container');
    fc.innerHTML = '';
    fc.hidden    = true;
    _mcpEditorCurrentEntry  = null;
    _mcpEditorFeatureGetter = () => ({});
    document.querySelectorAll('.mcp-editor-item').forEach(b => b.classList.remove('selected'));
  });

  document.getElementById('mcp-ef-transport').addEventListener('change', e => {
    toggleTransportFields(e.target.value);
  });

  document.getElementById('mcp-ef-save-btn').addEventListener('click', async () => {
    const errEl = document.getElementById('mcp-ef-error');
    errEl.textContent = '';
    const entry = buildEntryFromForm();
    if (!entry.id)   { errEl.textContent = 'ID is required.'; return; }
    if (!entry.name) { errEl.textContent = 'Name is required.'; return; }

    const isNew  = !_mcpEditorSelected;
    const url    = isNew ? '/api/mcp/catalogue' : `/api/mcp/catalogue/${encodeURIComponent(_mcpEditorSelected)}`;
    const method = isNew ? 'POST' : 'PATCH';

    try {
      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      }).then(r => r.json());
      if (res.error) { errEl.textContent = res.error; return; }
      _mcpEditorSelected = entry.id;
      await fetchAndRenderEditorList();
      fetchMCPCatalogue();
    } catch { errEl.textContent = 'Save failed.'; }
  });

  document.getElementById('mcp-ef-remove-btn').addEventListener('click', async () => {
    if (!_mcpEditorSelected) return;
    const errEl = document.getElementById('mcp-ef-error');
    errEl.textContent = '';
    try {
      const res = await fetch(`/api/mcp/catalogue/${encodeURIComponent(_mcpEditorSelected)}`, {
        method: 'DELETE',
      }).then(r => r.json());
      if (res.error) { errEl.textContent = res.error; return; }
      clearEditorForm();
      await fetchAndRenderEditorList();
      fetchMCPCatalogue();
    } catch { errEl.textContent = 'Remove failed.'; }
  });
}
