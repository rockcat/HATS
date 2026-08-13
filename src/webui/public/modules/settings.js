// ── Settings modal ────────────────────────────────────────────────────────────

import { esc } from './utils.js';
import { setToolCallDetail, toolCallDetail } from './agent-detail.js';
import { resetProvidersCache, refreshProviderModels, loadProviders } from './providers.js';
import { resetPricingCache } from './pricing.js';
import { toggleMute } from './voice.js';

export const ENV_META = {
  ANTHROPIC_API_KEY:  { label: 'Anthropic API Key',        group: 'API Keys',     secret: true,  hint: 'sk-ant-…'             },
  OPENAI_API_KEY:     { label: 'OpenAI API Key',            group: 'API Keys',     secret: true,  hint: 'sk-proj-…'            },
  GEMINI_API_KEY:     { label: 'Google Gemini API Key',     group: 'API Keys',     secret: true,  hint: 'AIzaSy…'              },
  BRAVE_API_KEY:      { label: 'Brave Search API Key',      group: 'API Keys',     secret: true,  hint: ''                     },
  ANTHROPIC_MODEL:    { label: 'Anthropic Default Model',   group: 'Models',       secret: false, hint: 'claude-haiku-4-5-20251001' },
  OPENAI_MODEL:       { label: 'OpenAI Default Model',      group: 'Models',       secret: false, hint: 'gpt-4.1-mini'              },
  GEMINI_MODEL:       { label: 'Gemini Default Model',      group: 'Models',       secret: false, hint: 'gemini-2.5-flash'           },
  OLLAMA_BASE_URL:    { label: 'Ollama Server URL',         group: 'Local Models', secret: false, hint: 'http://localhost:11434/v1'  },
  OLLAMA_MODEL:       { label: 'Ollama Default Model',      group: 'Local Models', secret: false, hint: 'llama3.2'                   },
  LM_STUDIO_BASE_URL: { label: 'LM Studio Server URL',      group: 'Local Models', secret: false, hint: 'http://localhost:1234/v1'   },
  LM_STUDIO_MODEL:    { label: 'LM Studio Default Model',   group: 'Local Models', secret: false, hint: 'model name from LM Studio'  },
};

export const GROUP_ORDER = ['API Keys', 'Models', 'Local Models', 'Other'];

export function initSettings() {
  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('mute-btn').addEventListener('click', toggleMute);
  document.getElementById('settings-close').addEventListener('click', closeSettings);
  document.getElementById('settings-cancel').addEventListener('click', closeSettings);
  document.getElementById('settings-save').addEventListener('click', saveSettings);
  document.getElementById('settings-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('settings-modal')) closeSettings();
    const opt = e.target.closest('.toggle-slider-opt');
    if (opt) {
      const slider = opt.closest('.toggle-slider');
      slider.querySelectorAll('.toggle-slider-opt').forEach(b => b.classList.remove('active'));
      opt.classList.add('active');
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !document.getElementById('settings-modal').hidden) closeSettings();
  });
}

export function openSettings() {
  refreshProviderModels();
  const modal = document.getElementById('settings-modal');
  const body  = document.getElementById('settings-body');
  const msg   = document.getElementById('settings-msg');
  msg.textContent = '';
  msg.className   = 'settings-msg';
  body.innerHTML  = '<p class="settings-loading">Loading…</p>';
  modal.hidden    = false;

  Promise.all([
    fetch('/api/env').then(r => r.json()),
    fetch('/api/providers').then(r => r.json()),
    fetch('/api/project/human-name').then(r => r.json()).catch(() => ({ humanName: 'Human' })),
    fetch('/api/debug/logging').then(r => r.json()).catch(() => ({ logPrompts: false })),
  ])
    .then(([entries, providers, { humanName }, { logPrompts }]) =>
      renderSettingsBody(entries, providers, humanName, logPrompts))
    .catch(() => { body.innerHTML = '<p class="settings-loading">Failed to load settings.</p>'; });
}

export function renderSettingsBody(entries, providers, humanName, logPrompts) {
  const body    = document.getElementById('settings-body');
  const grouped = {};

  for (const entry of entries) {
    const meta  = ENV_META[entry.key];
    const group = meta ? meta.group : 'Other';
    if (!grouped[group]) grouped[group] = [];
    grouped[group].push({ ...entry, meta });
  }

  for (const [key, meta] of Object.entries(ENV_META)) {
    const group = meta.group;
    if (!grouped[group]) grouped[group] = [];
    if (!grouped[group].some(e => e.key === key)) {
      grouped[group].push({ key, value: '', isSecret: meta.secret, meta });
    }
  }

  let html = `
    <div class="settings-section">
      <div class="settings-section-title">Profile</div>
      <div class="env-field">
        <label class="env-label" for="setting-human-name">Your name</label>
        <input type="text" id="setting-human-name" class="env-input" data-setting="humanName"
               value="${esc(humanName ?? 'Human')}" placeholder="Human" autocomplete="off" spellcheck="false">
      </div>
      <div class="env-field env-field--toggle">
        <label class="env-label" for="setting-debug-logging">Prompt debug logging</label>
        <input type="checkbox" id="setting-debug-logging" data-setting="debugLogging"${logPrompts ? ' checked' : ''}>
      </div>
      <div class="env-field env-field--toggle">
        <label class="env-label" for="setting-tool-detail">Tool call detail</label>
        <div class="toggle-slider" id="setting-tool-detail" data-setting="toolCallDetail">
          <button class="toggle-slider-opt${toolCallDetail === 'simple'   ? ' active' : ''}" data-val="simple">Simple</button>
          <button class="toggle-slider-opt${toolCallDetail === 'detailed' ? ' active' : ''}" data-val="detailed">Detailed</button>
        </div>
      </div>
    </div>`;

  for (const group of GROUP_ORDER) {
    const items = grouped[group];
    if (!items || items.length === 0) continue;
    html += `<div class="settings-section"><div class="settings-section-title">${esc(group)}</div>`;
    for (const item of items) {
      const label   = item.meta ? item.meta.label : item.key;
      const hint    = item.meta?.hint || '';
      const inputId = `env-field-${item.key}`;
      if (item.isSecret) {
        html += `
          <div class="env-field">
            <label class="env-label" for="${inputId}">${esc(label)}</label>
            <div class="env-secret-wrap">
              <input type="password" id="${inputId}" class="env-input" data-key="${esc(item.key)}"
                     value="${esc(item.value)}" placeholder="${esc(hint)}" autocomplete="off" spellcheck="false">
              <button class="env-eye" type="button" data-for="${inputId}" title="Show/hide value">
                <span class="eye-icon">👁</span>
              </button>
            </div>
          </div>`;
      } else {
        html += `
          <div class="env-field">
            <label class="env-label" for="${inputId}">${esc(label)}</label>
            <input type="text" id="${inputId}" class="env-input" data-key="${esc(item.key)}"
                   value="${esc(item.value)}" placeholder="${esc(hint)}" autocomplete="off" spellcheck="false">
          </div>`;
      }
    }
    html += '</div>';
  }

  if (providers && providers.length) {
    html += `<div class="settings-section"><div class="settings-section-title">Provider Status <button id="refresh-models-btn" class="modal-btn secondary" style="font-size:11px;padding:2px 8px;margin-left:8px">Refresh models</button><button id="update-pricing-btn" class="modal-btn secondary" style="font-size:11px;padding:2px 8px;margin-left:6px" title="Fetch current pricing from provider websites using Claude Haiku">Update pricing</button></div>`;
    for (const p of providers) {
      const dot        = p.available ? '🟢' : '🔴';
      const modelCount = p.models?.length ? ` · ${p.models.length} model${p.models.length !== 1 ? 's' : ''}` : '';
      let note = p.available ? ` · ${esc(p.defaultModel ?? '')}${modelCount}` : ' · no API key set';
      if (p.baseUrlEnvKey) note = ` · ${esc(p.baseUrl || p.defaultBaseUrl || '')}${p.available ? modelCount : ' · offline'}`;
      html += `<div class="provider-status-row"><span>${dot} ${esc(p.label)}</span><span class="provider-status-note">${note}</span></div>`;
    }
    html += '</div>';
  }

  body.innerHTML = html;

  document.getElementById('refresh-models-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('refresh-models-btn');
    btn.disabled = true; btn.textContent = 'Refreshing…';
    resetProvidersCache();
    await refreshProviderModels(true);
    openSettings();
  });

  document.getElementById('update-pricing-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('update-pricing-btn');
    btn.disabled = true; btn.textContent = 'Fetching…';
    try {
      const r = await fetch('/api/pricing/refresh', { method: 'POST' }).then(res => res.json());
      if (r.error) throw new Error(r.error);
      resetPricingCache();
      const summary = `+${r.added} added, ${r.updated} updated, ${r.unchanged} unchanged`;
      btn.textContent = `✓ ${summary}`;
      const msgEl = document.getElementById('settings-msg');
      if (msgEl) { msgEl.textContent = `Pricing updated: ${summary}`; msgEl.className = 'settings-msg settings-msg--ok'; }
    } catch (err) {
      btn.textContent = `✗ ${err.message}`;
    }
    setTimeout(() => {
      if (document.getElementById('update-pricing-btn')) {
        document.getElementById('update-pricing-btn').disabled = false;
        document.getElementById('update-pricing-btn').textContent = 'Update pricing';
      }
    }, 6000);
  });

  body.querySelectorAll('.env-eye').forEach(btn => {
    btn.addEventListener('click', () => {
      const inp = document.getElementById(btn.dataset.for);
      if (!inp) return;
      inp.type = inp.type === 'password' ? 'text' : 'password';
      btn.querySelector('.eye-icon').textContent = inp.type === 'password' ? '👁' : '🙈';
    });
  });
}

export function closeSettings() {
  document.getElementById('settings-modal').hidden = true;
}

export function saveSettings() {
  const inputs = document.getElementById('settings-body').querySelectorAll('.env-input[data-key]');
  const updates = {};
  inputs.forEach(inp => { updates[inp.dataset.key] = inp.value; });

  const profileInputs  = document.getElementById('settings-body').querySelectorAll('[data-setting]');
  const profileUpdates = {};
  profileInputs.forEach(inp => { profileUpdates[inp.dataset.setting] = inp.value; });

  const saveBtn = document.getElementById('settings-save');
  const msg     = document.getElementById('settings-msg');
  saveBtn.disabled = true;
  msg.textContent  = '';

  const envSave = fetch('/api/env', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  }).then(r => r.json());

  const humanName  = (profileUpdates['humanName'] ?? '').trim() || 'Human';
  const profileSave = fetch('/api/project/human-name', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ humanName }),
  }).then(r => r.json());

  const debugEnabled = document.getElementById('setting-debug-logging')?.checked ?? false;
  fetch('/api/debug/logging', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: debugEnabled }),
  }).catch(() => {});

  const toolDetailEl = document.getElementById('setting-tool-detail');
  if (toolDetailEl) {
    const chosen = toolDetailEl.querySelector('.toggle-slider-opt.active')?.dataset.val ?? 'simple';
    setToolCallDetail(chosen);
    localStorage.setItem('toolCallDetail', chosen);
  }

  Promise.all([envSave, profileSave])
    .then(([res]) => {
      if (res.error) {
        msg.textContent = res.error;
        msg.className   = 'settings-msg settings-msg--error';
      } else {
        msg.textContent = 'Saved.';
        msg.className   = 'settings-msg settings-msg--ok';
        setTimeout(closeSettings, 800);
      }
    })
    .catch(() => {
      msg.textContent = 'Save failed.';
      msg.className   = 'settings-msg settings-msg--error';
    })
    .finally(() => { saveBtn.disabled = false; });
}
