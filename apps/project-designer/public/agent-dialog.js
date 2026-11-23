/** The "edit deployed agent" modal — project-local overrides on a deployed agent. */

import { $, el } from '/ui-kit/hats-ui.js';
import { buildServerPicker, selectedServers } from '/ui-kit/server-picker.js';

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

/**
 * Which servers an agent may use is a subset of what the team runs, so the
 * options are the project's own list rather than the whole catalogue. An agent
 * pointed at a server the team does not run simply gets no tools from it, and
 * a free-text box gave no way to notice.
 */
function renderServerOptions(teamServers, chosen) {
  const picker = $('#agent-mcp-picker');
  const hint = $('#agent-mcp-hint');

  buildServerPicker(picker, teamServers, { selected: chosen, name: 'agentMcpServer' });
  hint.textContent = teamServers.length
    ? ''
    : 'This project has no team MCP servers yet — add some above.';
}

/**
 * What the agent needs is chosen from every shared server in the catalogue,
 * not only the team's: a need the team does not meet is exactly what this is
 * for.
 */
function renderNeeds(needs, allServers) {
  buildServerPicker($('#agent-needs-required'), allServers,
    { selected: needs?.tools?.required ?? [], name: 'needRequired' });
  buildServerPicker($('#agent-needs-preferred'), allServers,
    { selected: needs?.tools?.preferred ?? [], name: 'needPreferred' });
  $('#agent-form').elements['needsModel'].checked = needs?.models?.required === true;
}

/**
 * The needs the dialog shows, or undefined when there are none. A server
 * ticked in both lists counts as required.
 */
function readNeeds(previous) {
  const required = selectedServers($('#agent-needs-required'), 'needRequired');
  const preferred = selectedServers($('#agent-needs-preferred'), 'needPreferred')
    .filter((s) => !required.includes(s));
  const modelRequired = $('#agent-form').elements['needsModel'].checked;
  if (!required.length && !preferred.length && !modelRequired) return previous ? {} : undefined;
  return {
    ...((required.length || preferred.length) && {
      tools: { ...(required.length && { required }), ...(preferred.length && { preferred }) },
    }),
    ...(modelRequired && { models: { required: true } }),
  };
}

/**
 * Show the dialog for one deployed agent.
 *
 * @param {object} agent        the deployed agent
 * @param {Array}  teamServers  catalogue entries for the servers this project runs
 * @returns {Promise<object|null>} a patch body, or null when the user cancels
 */
export function openAgentDialog(agent, teamServers = [], allServers = teamServers) {
  const dialog = $('#agent-dialog');
  const form = $('#agent-form');

  $('#agent-dialog-title').textContent = `Edit ${agent.name}`;
  form.elements['name'].value = agent.name ?? '';
  form.elements['projectRole'].value = agent.projectRole ?? '';
  form.elements['provider'].value = agent.model?.provider ?? 'anthropic';
  form.elements['model'].value = agent.model?.model ?? '';
  form.elements['maxCostPerHour'].value = agent.limits?.maxCostPerHour ?? '';
  form.elements['enabled'].checked = agent.enabled !== false;

  // An absent allow-list means every team server, which is the default.
  const allowList = agent.tools?.enabledMcpServers;
  const useAll = allowList === undefined;
  form.elements['allMcpServers'].checked = useAll;
  renderServerOptions(teamServers, allowList ?? []);
  $('#agent-mcp-picker').hidden = useAll;
  renderNeeds(agent.needs, allServers);
  refreshModels();

  return new Promise((resolve) => {
    const onToggle = () => {
      $('#agent-mcp-picker').hidden = form.elements['allMcpServers'].checked;
    };
    form.elements['allMcpServers'].addEventListener('change', onToggle);

    const onClose = () => {
      dialog.removeEventListener('close', onClose);
      form.elements['allMcpServers'].removeEventListener('change', onToggle);
      if (dialog.returnValue !== 'save') { resolve(null); return; }

      const cost = form.elements['maxCostPerHour'].value;
      const patch = {
        name: form.elements['name'].value.trim(),
        projectRole: form.elements['projectRole'].value.trim() || undefined,
        model: {
          provider: form.elements['provider'].value,
          model: form.elements['model'].value.trim(),
        },
        enabled: form.elements['enabled'].checked,
        // An explicit empty list is meaningful — "this agent gets no team
        // servers" — so it is sent, while "use everything" clears the field.
        tools: {
          ...(agent.tools ?? {}),
          enabledMcpServers: form.elements['allMcpServers'].checked
            ? undefined
            : selectedServers($('#agent-mcp-picker'), 'agentMcpServer'),
        },
      };
      const needs = readNeeds(agent.needs);
      if (needs) patch.needs = needs;
      // Only send limits when they carry a value — the schema rejects empty objects with nulls.
      if (cost !== '') patch.limits = { ...(agent.limits ?? {}), maxCostPerHour: Number(cost) };
      else if (agent.limits?.maxContextTokens) patch.limits = { maxContextTokens: agent.limits.maxContextTokens };

      for (const key of Object.keys(patch)) if (patch[key] === undefined) delete patch[key];
      resolve(patch);
    };
    dialog.addEventListener('close', onClose);
    dialog.showModal();
  });
}
