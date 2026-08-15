// ── Pricing catalogue ─────────────────────────────────────────────────────────

let _pricingCache = null; // { pricing, freeProviders, contextWindows }

export function resetPricingCache() {
  _pricingCache = null;
}

export async function loadPricing() {
  if (_pricingCache) return _pricingCache;
  try {
    _pricingCache = await fetch('/api/pricing').then(r => r.json());
  } catch { _pricingCache = { pricing: {}, freeProviders: [], contextWindows: {} }; }
  return _pricingCache;
}

/** Show a price hint or unknown-model warning below the model select. */
export async function updatePricingHint(providerId, modelId, lineEl, hintEl) {
  if (!lineEl || !hintEl) return;
  if (!modelId) { lineEl.hidden = true; return; }

  const { pricing, freeProviders } = await loadPricing();

  if (freeProviders.includes(providerId)) {
    hintEl.className  = 'agent-config-pricing-hint agent-config-pricing-free';
    hintEl.textContent = 'Free — local inference, no API cost';
    lineEl.hidden      = false;
    return;
  }

  const p = pricing[modelId];
  if (p) {
    hintEl.className  = 'agent-config-pricing-hint agent-config-pricing-known';
    hintEl.textContent = `$${p.input}/M input · $${p.output}/M output tokens`;
    lineEl.hidden      = false;
  } else {
    hintEl.className  = 'agent-config-pricing-hint agent-config-pricing-unknown';
    hintEl.textContent = 'Pricing unknown for this model — costs may be incorrect in telemetry';
    lineEl.hidden      = false;
  }
}

/** Update the max-context placeholder to match the selected model's context window. */
export async function updateContextWindowPlaceholder(modelId) {
  const input = document.getElementById('add-agent-max-context');
  if (!input) return;
  const { contextWindows } = await loadPricing();
  const cw = contextWindows?.[modelId];
  input.placeholder = cw ? `${cw.toLocaleString()} (model max)` : 'Model default';
}
