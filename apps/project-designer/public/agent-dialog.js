/** The "edit deployed agent" modal — project-local overrides on a deployed agent. */

import { $, el } from '/ui-kit/hats-ui.js';

let providers = [];

export function setProviderCatalogue(list) {
  providers = list ?? [];
  const select = $('#agent-form').elements['provider'];
  select.replaceChildren(...providers.map((p) => el('option', { value: p.name }, p.label ?? p.name)));
  select.addEventListener('change', refreshModels);
}

function refreshModels() {
  const form = $('#agent-form');
  const provider = providers.find((p) => p.name === form.elements['provider'].value);
  $('#agent-model-options').replaceChildren(...(provider?.models ?? []).map((m) => el('option', { value: m })));
}

const csv = (value) => (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);

/**
 * Show the dialog for one deployed agent.
 * Resolves to a patch body, or null when the user cancels.
 */
export function openAgentDialog(agent) {
  const dialog = $('#agent-dialog');
  const form = $('#agent-form');

  $('#agent-dialog-title').textContent = `Edit ${agent.name}`;
  form.elements['name'].value = agent.name ?? '';
  form.elements['projectRole'].value = agent.projectRole ?? '';
  form.elements['provider'].value = agent.model?.provider ?? 'anthropic';
  form.elements['model'].value = agent.model?.model ?? '';
  form.elements['maxCostPerHour'].value = agent.limits?.maxCostPerHour ?? '';
  form.elements['enabledMcpServers'].value = (agent.tools?.enabledMcpServers ?? []).join(', ');
  form.elements['enabled'].checked = agent.enabled !== false;
  refreshModels();

  return new Promise((resolve) => {
    const onClose = () => {
      dialog.removeEventListener('close', onClose);
      if (dialog.returnValue !== 'save') { resolve(null); return; }

      const servers = csv(form.elements['enabledMcpServers'].value);
      const cost = form.elements['maxCostPerHour'].value;
      const patch = {
        name: form.elements['name'].value.trim(),
        projectRole: form.elements['projectRole'].value.trim() || undefined,
        model: {
          provider: form.elements['provider'].value,
          model: form.elements['model'].value.trim(),
        },
        enabled: form.elements['enabled'].checked,
      };
      // Only send limits/tools when they carry a value — the schema rejects empty objects with nulls.
      if (cost !== '') patch.limits = { ...(agent.limits ?? {}), maxCostPerHour: Number(cost) };
      else if (agent.limits?.maxContextTokens) patch.limits = { maxContextTokens: agent.limits.maxContextTokens };
      if (servers.length) patch.tools = { ...(agent.tools ?? {}), enabledMcpServers: servers };

      for (const key of Object.keys(patch)) if (patch[key] === undefined) delete patch[key];
      resolve(patch);
    };
    dialog.addEventListener('close', onClose);
    dialog.showModal();
  });
}
