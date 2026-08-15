// ── Provider / model catalogue ────────────────────────────────────────────────

let _providersCache = null;
let _modelsRefreshPromise = null;

export function resetProvidersCache() {
  _providersCache = null;
}

/** Load provider metadata (fast — static models unless server cache already warm). */
export function loadProviders() {
  if (_providersCache) return Promise.resolve(_providersCache);
  return fetch('/api/providers')
    .then(r => r.json())
    .then(list => { _providersCache = list; return list; })
    .catch(() => []);
}

/**
 * Fetch live models from the server (server applies per-provider TTL caching).
 * Pass force=true to bypass server cache and re-query provider APIs immediately.
 */
export async function refreshProviderModels(force = false) {
  if (_modelsRefreshPromise && !force) return _modelsRefreshPromise;
  _modelsRefreshPromise = (async () => {
    try {
      const url = force ? '/api/providers/models?refresh=true' : '/api/providers/models';
      const list = await fetch(url).then(r => r.json());
      const providers = await loadProviders();
      let changed = false;
      for (const { id, models } of list) {
        const p = providers.find(p => p.id === id);
        if (!p) continue;
        const prev = JSON.stringify(p.models);
        if (JSON.stringify(models) !== prev && models.length > 0) {
          p.models = models;
          if (!models.includes(p.defaultModel) && models.length > 0) {
            p.defaultModel = models[0];
          }
          changed = true;
        }
      }
      if (changed) onModelsRefreshed();
    } catch { /* non-fatal — static models remain */ }
    _modelsRefreshPromise = null;
  })();
  return _modelsRefreshPromise;
}

/** Called after live models are merged into _providersCache. Re-populates any open model selects. */
export function onModelsRefreshed() {
  if (!_providersCache) return;
  // Agent config panel
  const agentProvSel  = document.getElementById('agent-config-provider');
  const agentModelSel = document.getElementById('agent-config-model');
  if (agentProvSel && agentModelSel && !agentModelSel.hidden) {
    const pid      = agentProvSel.value;
    const current  = agentModelSel.value;
    const provider = _providersCache.find(p => p.id === pid);
    applyLocalProviderUI(provider);
    if (!agentModelSel.hidden) populateModelSelect(agentModelSel, _providersCache, pid, current);
  }
  // Add-agent panel
  const addProvSel  = document.getElementById('add-agent-provider');
  const addModelSel = document.getElementById('add-agent-model');
  if (addProvSel && addModelSel && !addModelSel.closest('[hidden]')) {
    const pid     = addProvSel.value;
    const current = addModelSel.value;
    populateModelSelect(addModelSel, _providersCache, pid, current);
  }
}

/** Populate the provider <select> from the catalogue. */
export function populateProviderSelect(sel, providers, selectedId) {
  sel.innerHTML = '';
  for (const p of providers) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.label;
    opt.selected = p.id === selectedId;
    sel.appendChild(opt);
  }
}

/** Switch between model dropdown vs free-text input for local providers with no model list. */
export function applyLocalProviderUI(provider) {
  const modelSel   = document.getElementById('agent-config-model');
  const modelInput = document.getElementById('agent-config-model-custom');
  const noModels   = !!provider?.baseUrlEnvKey && (!provider.models || provider.models.length === 0);
  modelSel.hidden   = noModels;
  modelInput.hidden = !noModels;
}

/** Populate the model <select> with the model list for the given provider. */
export function populateModelSelect(sel, providers, providerId, selectedModel) {
  const provider = providers.find(p => p.id === providerId);
  const models   = provider ? provider.models : [];
  sel.innerHTML  = '';

  const list = models.includes(selectedModel) || !selectedModel
    ? models
    : [selectedModel, ...models];

  for (const m of list) {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    opt.selected = m === selectedModel;
    sel.appendChild(opt);
  }
}
