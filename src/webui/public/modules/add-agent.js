// ── Add Agent modal / Library editor ─────────────────────────────────────────

import { esc } from './utils.js';
import { hat } from './hat.js';
import { populateHatGroup, getSelectedHats } from './hat.js';
import { getVoices } from './voice.js';
import { ensureAudioCtx } from './voice.js';
import { getAvatars } from './avatars.js';
import { getSpecValue, setSpecValue } from './specialisations.js';
import { loadProviders, refreshProviderModels, populateProviderSelect, populateModelSelect } from './providers.js';
import { updatePricingHint, updateContextWindowPlaceholder } from './pricing.js';
import { populateBackgroundSelect } from './files.js';
import { fetchGlobalAgents } from './library.js';

// Injected at init time to break library ↔ add-agent circular dep.
let _fetchGlobalAgentsFromLib = fetchGlobalAgents;

export function initAddAgent({ fetchGlobalAgentsOverride } = {}) {
  if (fetchGlobalAgentsOverride) _fetchGlobalAgentsFromLib = fetchGlobalAgentsOverride;

  document.getElementById('add-agent-btn').addEventListener('click', openAddAgent);
  document.getElementById('add-agent-close').addEventListener('click', closeAddAgent);
  document.getElementById('add-agent-cancel').addEventListener('click', closeAddAgent);
  document.getElementById('add-agent-save').addEventListener('click', saveAddAgent);

  loadProviders().then(providers => {
    populateProviderSelect(document.getElementById('add-agent-provider'), providers, 'anthropic');
    const p = providers.find(p => p.id === 'anthropic');
    const defaultModel = p?.defaultModel ?? '';
    populateModelSelect(document.getElementById('add-agent-model'), providers, 'anthropic', defaultModel);
    updatePricingHint('anthropic', defaultModel, document.getElementById('lib-editor-pricing-line'), document.getElementById('lib-editor-pricing-hint'));
    updateContextWindowPlaceholder(defaultModel);
  });

  document.getElementById('add-agent-provider').addEventListener('change', async () => {
    const pid = document.getElementById('add-agent-provider').value;
    let providers = await loadProviders();
    if (providers.find(p => p.id === pid)?.baseUrlEnvKey) {
      await refreshProviderModels();
      providers = await loadProviders();
    }
    const p = providers.find(p => p.id === pid);
    populateModelSelect(document.getElementById('add-agent-model'), providers, pid, p?.defaultModel ?? '');
    const model = document.getElementById('add-agent-model').value;
    updatePricingHint(pid, model, document.getElementById('lib-editor-pricing-line'), document.getElementById('lib-editor-pricing-hint'));
    updateContextWindowPlaceholder(model);
  });

  document.getElementById('add-agent-model').addEventListener('change', () => {
    const pid   = document.getElementById('add-agent-provider').value;
    const model = document.getElementById('add-agent-model').value;
    updatePricingHint(pid, model, document.getElementById('lib-editor-pricing-line'), document.getElementById('lib-editor-pricing-hint'));
    updateContextWindowPlaceholder(model);
  });

  populateHatGroup('add-agent-hat-group', ['white']);

  document.getElementById('add-agent-specialisation').addEventListener('change', e => {
    const cust = document.getElementById('add-agent-specialisation-custom');
    cust.hidden = e.target.value !== '__custom__';
    if (!cust.hidden) cust.focus();
  });

  document.getElementById('add-agent-voice').addEventListener('change', () => {
    const voiceName  = document.getElementById('add-agent-voice').value;
    const speakerSel = document.getElementById('add-agent-speaker');
    getVoices().then(voices => {
      const voice = voices.find(v => v.name === voiceName);
      speakerSel.innerHTML = '<option value="">(default)</option>';
      if (voice?.speakers?.length) {
        const speakerNames = voice.speakers.map(s => typeof s === 'string' ? s : s.name)
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
        for (const sName of speakerNames) {
          const opt = document.createElement('option');
          opt.value = sName; opt.textContent = sName; speakerSel.appendChild(opt);
        }
        speakerSel.hidden = false;
      } else {
        speakerSel.hidden = true;
      }
    });
  });

  document.getElementById('add-agent-preview-voice').addEventListener('click', async () => {
    const voiceName   = document.getElementById('add-agent-voice').value || undefined;
    const speakerName = document.getElementById('add-agent-speaker').value || undefined;
    const btn = document.getElementById('add-agent-preview-voice');
    btn.disabled = true; btn.textContent = '…';
    try {
      const res = await fetch('/api/speech/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice: voiceName, speakerName }),
      });
      if (res.ok) {
        const buf = await res.arrayBuffer();
        const ctx = ensureAudioCtx();
        const audio = await ctx.decodeAudioData(buf);
        const src = ctx.createBufferSource();
        src.buffer = audio; src.connect(ctx.destination); src.start();
      }
    } catch { /* ignore */ }
    btn.innerHTML = '<img src="/assets/play.svg" class="svg-icon" alt="Play">'; btn.disabled = false;
  });

  document.getElementById('add-agent-avatar').addEventListener('change', () => {
    const file  = document.getElementById('add-agent-avatar').value;
    const bg    = document.getElementById('add-agent-background').value || null;
    const panel = document.getElementById('lib-avatar-panel');
    if (file) {
      panel.hidden = false;
      getAvatars().then(avatars => {
        const av = avatars.find(a => a.file === file);
        if (av && window.avatarAPI) {
          window.avatarAPI.show(av.file, av.camera, av.rotate, av.fov, av.scale, bg, 'lib-avatar-panel', 'lib-avatar-canvas');
        }
      });
    } else {
      panel.hidden = true;
      window.avatarAPI?.hide('lib-avatar-panel');
    }
  });

  document.getElementById('add-agent-background').addEventListener('change', () => {
    const bg    = document.getElementById('add-agent-background').value || null;
    const panel = document.getElementById('lib-avatar-panel');
    if (panel) panel.style.backgroundImage = bg ? `url('/backgrounds/${encodeURIComponent(bg)}')` : '';
    const avatarFile = document.getElementById('add-agent-avatar').value;
    if (avatarFile && window.avatarAPI) {
      getAvatars().then(avatars => {
        const av = avatars.find(a => a.file === avatarFile);
        if (av) window.avatarAPI.show(av.file, av.camera, av.rotate, av.fov, av.scale, bg, 'lib-avatar-panel', 'lib-avatar-canvas');
      });
    }
  });

  document.getElementById('add-agent-gen-bg').addEventListener('click', () => {
    document.getElementById('gen-bg-prompt').value  = '';
    document.getElementById('gen-bg-error').textContent = '';
    document.getElementById('gen-bg-preview').hidden = true;
    document.getElementById('gen-bg-spinner').hidden = true;
    document.getElementById('gen-bg-submit').disabled = false;
    document.getElementById('gen-bg-modal').hidden   = false;
    document.getElementById('gen-bg-prompt').focus();
  });

  for (const [fieldId, sectionKey] of Object.entries(PROMPT_FIELD_SECTIONS)) {
    const el = document.getElementById(fieldId);
    if (!el) continue;
    el.addEventListener('focusin', () => highlightPromptSection(sectionKey));
    el.addEventListener('click',   () => highlightPromptSection(sectionKey));
    el.addEventListener('input',   schedulePromptRefresh);
    el.addEventListener('change',  () => { highlightPromptSection(sectionKey); schedulePromptRefresh(); });
  }

  document.getElementById('add-agent-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeAddAgent();
  });
}

// ── Editor mode state ─────────────────────────────────────────────────────────

let _agentEditorMode = 'new';
let _libEditAgentId  = null;

export const PROMPT_SECTION_ORDER = [
  'identityAnchor','hatRoleStatement','specialisation','thinkingStyle',
  'communicationTone','directives','avoidances','teamRole','closingAnchor',
];

export const PROMPT_FIELD_SECTIONS = {
  'add-agent-name':                  ['identityAnchor'],
  'add-agent-visual-desc':           ['identityAnchor'],
  'add-agent-backstory':             ['identityAnchor'],
  'add-agent-hat-group':             ['hatRoleStatement', 'thinkingStyle'],
  'add-agent-specialisation':        ['specialisation'],
  'add-agent-specialisation-custom': ['specialisation'],
};

let _activePromptSection = null;
let _promptRefreshTimer  = null;

export function highlightPromptSection(keys) {
  _activePromptSection = keys;
  const keySet  = new Set(Array.isArray(keys) ? keys : [keys]);
  const textEl  = document.getElementById('lib-prompt-text');
  if (!textEl) return;
  textEl.querySelectorAll('.prompt-section').forEach(el => {
    el.classList.toggle('prompt-section--highlight', keySet.has(el.dataset.section));
  });
  const firstKey = Array.isArray(keys) ? keys[0] : keys;
  const target   = textEl.querySelector(`.prompt-section[data-section="${firstKey}"]`);
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

export function schedulePromptRefresh() {
  clearTimeout(_promptRefreshTimer);
  _promptRefreshTimer = setTimeout(() => openLibraryPromptPreview(), 600);
}

export async function openLibraryPromptPreview() {
  const name    = document.getElementById('add-agent-name').value.trim() || 'Agent';
  const hats    = getSelectedHats('add-agent-hat-group');
  const specialisation = (() => {
    const sel = document.getElementById('add-agent-specialisation').value;
    if (sel === '__custom__') return document.getElementById('add-agent-specialisation-custom').value.trim();
    return sel;
  })();
  const backstory         = document.getElementById('add-agent-backstory').value.trim();
  const visualDescription = document.getElementById('add-agent-visual-desc').value.trim();

  const params = new URLSearchParams({ name, backstory, specialisation, visualDescription });
  for (const h of hats) params.append('hat', h);

  const textEl   = document.getElementById('lib-prompt-text');
  const lengthEl = document.getElementById('lib-prompt-length');
  if (!textEl) return;
  textEl.innerHTML = '<span style="color:var(--text-muted);font-style:italic">Loading…</span>';
  if (lengthEl) lengthEl.textContent = '';

  try {
    const res     = await fetch(`/api/prompt-preview?${params}`);
    const data    = await res.json();
    const text    = data.prompt ?? '';
    const sections = data.sections ?? {};

    const parts = [];
    for (const key of PROMPT_SECTION_ORDER) {
      if (sections[key]) {
        parts.push(`<span class="prompt-section" data-section="${key}">${esc(sections[key])}</span>`);
      }
    }
    textEl.innerHTML = parts.length ? parts.join('\n\n') : `<span class="prompt-section">${esc(text)}</span>`;

    const chars      = text.length;
    const tokens     = Math.round(chars / 4);
    const toolsChars = data.toolsChars ?? 0;
    const toolTokens = Math.round(toolsChars / 4);
    const toolNote   = toolsChars ? `  +~${toolTokens.toLocaleString()} tool tokens` : '';
    if (lengthEl) lengthEl.textContent = `~${tokens.toLocaleString()} prompt tokens (${chars.toLocaleString()} chars)${toolNote}`;

    if (_activePromptSection) highlightPromptSection(_activePromptSection);
  } catch (err) {
    textEl.innerHTML = `<span style="color:var(--red)">Error: ${esc(err.message)}</span>`;
  }
}

// ── openAddAgent ──────────────────────────────────────────────────────────────

export function openAddAgent() {
  _agentEditorMode     = 'new';
  _libEditAgentId      = null;
  _activePromptSection = null;
  document.getElementById('add-agent-modal-title').textContent = 'Add Agent';
  document.getElementById('add-agent-save').textContent        = 'Add Agent';
  document.getElementById('add-agent-name').value             = '';
  document.getElementById('add-agent-visual-desc').value      = '';
  document.getElementById('add-agent-backstory').value        = '';
  getAvatars().then(avatars => {
    const sel = document.getElementById('add-agent-avatar');
    sel.innerHTML = '<option value="">(no avatar)</option>';
    for (const av of avatars) {
      const opt = document.createElement('option');
      opt.value = av.file; opt.textContent = av.name; sel.appendChild(opt);
    }
  });
  populateBackgroundSelect('', 'add-agent-background');
  getVoices().then(voices => {
    const voiceSel = document.getElementById('add-agent-voice');
    voiceSel.innerHTML = '<option value="">(no voice)</option>';
    for (const v of voices) {
      const opt = document.createElement('option');
      opt.value = v.name; opt.textContent = v.name + (v.speakers?.length ? ` [${v.speakers.length} spk]` : '');
      voiceSel.appendChild(opt);
    }
  });
  document.getElementById('add-agent-speaker').innerHTML = '<option value="">(default)</option>';
  document.getElementById('add-agent-speaker').hidden    = true;
  setSpecValue('add-agent-specialisation', 'add-agent-specialisation-custom', '');
  document.getElementById('add-agent-error').textContent = '';
  document.getElementById('add-agent-schedules-section').hidden = true;
  const maxCtxEl  = document.getElementById('add-agent-max-context');
  const maxCostEl = document.getElementById('add-agent-max-cost');
  if (maxCtxEl)  maxCtxEl.value  = '';
  if (maxCostEl) maxCostEl.value = '';
  document.getElementById('lib-editor-pricing-line').hidden = true;
  document.getElementById('lib-avatar-panel').hidden        = false;
  document.getElementById('add-agent-modal').hidden         = false;
  document.getElementById('add-agent-name').focus();
  openLibraryPromptPreview();
}

// ── openLibraryEdit (called by library.js via injection) ──────────────────────

export async function openLibraryEdit(agent) {
  _agentEditorMode     = 'edit';
  _activePromptSection = null;
  _libEditAgentId      = agent.id;
  document.getElementById('add-agent-modal-title').textContent = 'Edit Agent';
  document.getElementById('add-agent-save').textContent        = 'Save';
  document.getElementById('add-agent-error').textContent       = '';

  document.getElementById('add-agent-name').value        = agent.identity?.name ?? '';
  document.getElementById('add-agent-visual-desc').value = agent.identity?.visualDescription ?? '';
  document.getElementById('add-agent-backstory').value   = agent.identity?.backstory ?? '';
  populateHatGroup('add-agent-hat-group', agent.hatType ?? ['none']);
  setSpecValue('add-agent-specialisation', 'add-agent-specialisation-custom', agent.identity?.specialisation ?? '');

  const provSel  = document.getElementById('add-agent-provider');
  const modelSel = document.getElementById('add-agent-model');
  const providers = await loadProviders();
  const providerName = agent.providerName ?? 'anthropic';
  populateProviderSelect(provSel, providers, providerName);
  populateModelSelect(modelSel, providers, providerName, agent.model ?? '');
  updatePricingHint(providerName, agent.model ?? '', document.getElementById('lib-editor-pricing-line'), document.getElementById('lib-editor-pricing-hint'));
  updateContextWindowPlaceholder(agent.model ?? '');

  const maxCtxEl  = document.getElementById('add-agent-max-context');
  const maxCostEl = document.getElementById('add-agent-max-cost');
  if (maxCtxEl)  maxCtxEl.value  = agent.maxContextTokens != null ? String(agent.maxContextTokens) : '';
  if (maxCostEl) maxCostEl.value = agent.maxCostPerHour   != null ? String(agent.maxCostPerHour)   : '';

  const avatarSel     = document.getElementById('add-agent-avatar');
  const currentAvatar = agent.identity?.avatar ?? '';
  const currentBg     = agent.identity?.background ?? '';
  document.getElementById('lib-avatar-panel').hidden = true;
  getAvatars().then(avatars => {
    avatarSel.innerHTML = '<option value="">(no avatar)</option>';
    for (const av of avatars) {
      const opt = document.createElement('option');
      opt.value = av.file; opt.textContent = av.name; avatarSel.appendChild(opt);
    }
    avatarSel.value = currentAvatar;
    if (currentAvatar && window.avatarAPI) {
      const av = avatars.find(a => a.file === currentAvatar);
      if (av) {
        document.getElementById('lib-avatar-panel').hidden = false;
        window.avatarAPI.show(av.file, av.camera, av.rotate, av.fov, av.scale, currentBg || null, 'lib-avatar-panel', 'lib-avatar-canvas');
      }
    }
  });

  populateBackgroundSelect(currentBg, 'add-agent-background');

  const voiceSel   = document.getElementById('add-agent-voice');
  const speakerSel = document.getElementById('add-agent-speaker');
  getVoices().then(voices => {
    voiceSel.innerHTML = '<option value="">(no voice)</option>';
    for (const v of voices) {
      const opt = document.createElement('option');
      opt.value = v.name; opt.textContent = v.name + (v.speakers?.length ? ` [${v.speakers.length} spk]` : '');
      voiceSel.appendChild(opt);
    }
    const currentVoice = agent.identity?.voice ?? '';
    voiceSel.value = currentVoice;
    const voice    = voices.find(v => v.name === currentVoice);
    speakerSel.innerHTML = '<option value="">(default)</option>';
    if (voice?.speakers?.length) {
      const speakerNames = voice.speakers.map(s => typeof s === 'string' ? s : s.name)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
      for (const sName of speakerNames) {
        const opt = document.createElement('option');
        opt.value = sName; opt.textContent = sName; speakerSel.appendChild(opt);
      }
      speakerSel.value  = agent.identity?.speakerName ?? '';
      speakerSel.hidden = false;
    } else {
      speakerSel.hidden = true;
    }
  });

  const schedSection = document.getElementById('add-agent-schedules-section');
  const schedList    = document.getElementById('add-agent-schedules-list');
  try {
    const actions  = await fetch('/api/scheduled-actions').then(r => r.json());
    const assigned = new Set(agent.scheduledActionIds ?? []);
    if (actions.length === 0) {
      schedList.innerHTML = '<span style="color:var(--text-muted);font-size:12px">No global scheduled actions defined yet.</span>';
    } else {
      schedList.innerHTML = actions.map(a => `
        <label class="add-agent-sched-label">
          <input type="checkbox" class="add-agent-sched-cb" value="${esc(a.id)}"${assigned.has(a.id) ? ' checked' : ''}>
          <span>${esc(a.label)}</span>
        </label>`).join('');
    }
    schedSection.hidden = false;
  } catch {
    schedSection.hidden = true;
  }

  document.getElementById('add-agent-modal').hidden = false;
  document.getElementById('add-agent-name').focus();
  openLibraryPromptPreview();
}

// ── closeAddAgent / saveAddAgent ──────────────────────────────────────────────

export function closeAddAgent() {
  window.avatarAPI?.hide('lib-avatar-panel');
  document.getElementById('lib-avatar-panel').hidden  = true;
  document.getElementById('add-agent-modal').hidden   = true;
}

export async function saveAddAgent() {
  const name              = document.getElementById('add-agent-name').value.trim();
  const hatTypes          = getSelectedHats('add-agent-hat-group');
  const specialisation    = getSpecValue('add-agent-specialisation', 'add-agent-specialisation-custom');
  const provider          = document.getElementById('add-agent-provider').value;
  const model             = document.getElementById('add-agent-model').value;
  const visualDescription = document.getElementById('add-agent-visual-desc').value.trim();
  const backstory         = document.getElementById('add-agent-backstory').value.trim();
  const avatar            = document.getElementById('add-agent-avatar').value || null;
  const voice             = document.getElementById('add-agent-voice').value || null;
  const speakerName       = document.getElementById('add-agent-speaker').value || null;
  const background        = document.getElementById('add-agent-background').value || null;
  const maxContextRaw     = document.getElementById('add-agent-max-context')?.value?.trim();
  const maxCostRaw        = document.getElementById('add-agent-max-cost')?.value?.trim();
  const maxContextTokens  = maxContextRaw ? (parseInt(maxContextRaw, 10) || null) : null;
  const maxCostPerHour    = maxCostRaw    ? (parseFloat(maxCostRaw)      || null) : null;
  const errEl             = document.getElementById('add-agent-error');
  errEl.textContent       = '';
  if (!name) { errEl.textContent = 'Name is required.'; return; }
  const btn = document.getElementById('add-agent-save');
  btn.disabled = true; btn.textContent = '…';

  try {
    if (_agentEditorMode === 'edit' && _libEditAgentId) {
      const body = { name, hatTypes, visualDescription, backstory, specialisation, provider, model, avatar, voice, speakerName, background, maxContextTokens, maxCostPerHour };
      const r = await fetch(`/api/global-agents/${encodeURIComponent(_libEditAgentId)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!r.ok) { const e = await r.json(); errEl.textContent = e.error ?? 'Save failed'; btn.disabled = false; btn.textContent = 'Save'; return; }

      const checkboxes       = document.querySelectorAll('#add-agent-schedules-list .add-agent-sched-cb:checked');
      const scheduledActionIds = Array.from(checkboxes).map(cb => cb.value);
      await fetch(`/api/global-agents/${encodeURIComponent(_libEditAgentId)}/scheduled-actions`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scheduledActionIds }),
      });

      closeAddAgent();
      _fetchGlobalAgentsFromLib();
    } else {
      const res = await fetch('/api/agents', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, hatTypes,
          visualDescription: visualDescription || undefined,
          backstory:         backstory         || undefined,
          specialisation:    specialisation    || undefined,
          provider, model,
        }),
      }).then(r => r.json());
      if (res.error) { errEl.textContent = res.error; }
      else { closeAddAgent(); }
    }
  } catch { errEl.textContent = 'Failed to save agent.'; }

  btn.disabled = false;
  btn.textContent = _agentEditorMode === 'edit' ? 'Save' : 'Add Agent';
}
