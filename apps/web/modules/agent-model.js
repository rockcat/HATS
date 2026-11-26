// ── An agent's model in this project ───────────────────────────────────────────
//
// Shown beside its limits, with what the model costs and what the agent has
// spent this hour. Changing it swaps the model on the running agent; the
// library template is left alone.

import {
  loadProviders, populateProviderSelect, populateModelSelect, applyLocalProviderUI,
} from './providers.js';
import { updatePricingHint } from './pricing.js';

const el = id => document.getElementById(id);

/** External agents (Claude Code and the like) run their own model; there is nothing to pick. */
export function isExternal(agent) {
  return agent?.provider === 'external';
}

/** "$0.12 spent this hour", or "" when the agent has spent nothing it reports. */
export function spendText(agent) {
  const spent = agent?.hourlyCost;
  if (spent == null || isExternal(agent)) return '';
  return `$${spent.toFixed(2)} spent this hour`;
}

/** The body for the config route, or null when the provider and model are unchanged. */
export function modelChange(agent, provider, model) {
  const m = String(model ?? '').trim();
  if (!m || isExternal(agent)) return null;
  if (provider === agent?.provider && m === agent?.model) return null;
  return { provider, model: m };
}

let bound = null; // the agent the fields were filled for

function chosenModel() {
  const custom = el('agent-config-model-custom');
  return custom && !custom.hidden ? custom.value : el('agent-config-model')?.value;
}

function refreshHint() {
  updatePricingHint(el('agent-config-provider')?.value, chosenModel(),
    el('agent-config-pricing-line'), el('agent-config-pricing-hint'));
}

async function showModels(providerId, model) {
  const providers = await loadProviders();
  const provider  = providers.find(p => p.id === providerId);
  applyLocalProviderUI(provider);
  populateModelSelect(el('agent-config-model'), providers, providerId, model);
  el('agent-config-model-custom').value = model ?? '';
  refreshHint();
}

/** Fill the model fields for this agent. */
export async function bindAgentModel(agent) {
  bound = agent ?? null;
  const external = isExternal(agent);
  el('agent-config-model-pickers').hidden   = external;
  el('agent-config-model-external').hidden  = !external;
  el('agent-config-model-external').textContent = external ? (agent?.model || 'Runs its own model') : '';
  el('agent-config-spend').textContent = spendText(agent);
  if (external) { el('agent-config-pricing-line').hidden = true; return; }

  const providers = await loadProviders();
  populateProviderSelect(el('agent-config-provider'), providers, agent?.provider ?? 'anthropic');
  await showModels(agent?.provider ?? 'anthropic', agent?.model ?? '');
}

/** Keep the spend current while the panel is open. */
export function refreshAgentSpend(agent) {
  const spend = el('agent-config-spend');
  if (spend) spend.textContent = spendText(agent);
}

export function initAgentModel() {
  el('agent-config-provider').addEventListener('change', async () => {
    const pid = el('agent-config-provider').value;
    const provider = (await loadProviders()).find(p => p.id === pid);
    await showModels(pid, provider?.defaultModel ?? '');
  });
  el('agent-config-model').addEventListener('change', refreshHint);
  el('agent-config-model-custom').addEventListener('input', refreshHint);
}

/** Save the model if it changed; part of the Configure panel's Apply. */
export async function saveAgentModel(name) {
  const body = modelChange(bound, el('agent-config-provider')?.value, chosenModel());
  if (!body) return;
  const r = await fetch(`/api/agents/${encodeURIComponent(name)}/config`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Could not change the model');
  bound = { ...bound, ...body };
}
