/**
 * Which of an agent's MCP tools go in front of the model.
 *
 * Every tool an agent can reach is either sent in the tool list of every call,
 * or found with `search_tools` when it is needed. The default is all of the
 * agent's own servers, because an agent given a mailbox should not have to
 * discover it — but a mail server can offer fifty tools where an assistant uses
 * five, and the other forty-five are paid for on every request.
 *
 * The tool names come from the catalogue, where the runner records what each
 * server offered when it last connected. The library starts no MCP servers, so
 * until a server has run once there is nothing to list and only the whole
 * server can be chosen.
 *
 * What can be offered and how a selection is written down are in
 * `upfront-model.js`, which has no DOM and is tested on its own.
 */

import { $, $$, clear, el } from '/ui-kit/hats-ui.js';
import { combineSelection, isSelected, toolSources } from '/upfront-model.js';

const ALL = 'all';
const CHOOSE = 'choose';

/** Catalogue entries this agent can draw tools from, personal first. */
let sources = [];

/** Point the picker at what this agent can currently reach. */
export function setToolSources(catalogue, configuredPersonal, enabledShared) {
  sources = toolSources(catalogue, configuredPersonal, enabledShared);
  return sources;
}

function serverBlock(entry, selected) {
  const tools = entry.knownTools ?? [];
  const wholeServer = selected.has(entry.id.toLowerCase());

  const head = el('label', { class: 'tool-server-head' },
    el('input', {
      type: 'checkbox', name: 'upfrontServer', value: entry.id, checked: wholeServer,
      title: `Send every tool ${entry.name} offers`,
    }),
    el('span', { class: 'tool-server-name' },
      entry.name,
      el('span', { class: `tag ${entry.scope === 'personal' ? 'ok' : ''}` }, entry.scope),
      tools.length ? el('span', { class: 'muted mono' }, `${tools.length} tools`) : null,
    ),
  );

  if (tools.length === 0) {
    return el('div', { class: 'tool-server' }, head,
      el('div', { class: 'tool-unknown' },
        'No tool list yet — it is recorded the first time the Team Runner connects to this server. '
        + 'Until then only the whole server can be chosen.'),
    );
  }

  const list = el('div', { class: 'tool-list' },
    ...tools.map((tool) => el('label', { class: 'tool-option', title: tool.description },
      el('input', {
        type: 'checkbox', name: 'upfrontTool', value: `${entry.id}:${tool.name}`,
        checked: isSelected(selected, entry.id, tool.name),
        disabled: wholeServer,
      }),
      el('span', { class: 'tool-text' },
        el('code', {}, tool.name),
        el('span', { class: 'tool-desc' }, tool.description),
      ),
    )),
  );

  // Ticking the server covers everything under it, so the individual boxes go
  // quiet rather than disappearing.
  head.querySelector('input').addEventListener('change', (event) => {
    for (const input of $$('input[name="upfrontTool"]', list)) input.disabled = event.target.checked;
  });

  return el('div', { class: 'tool-server' }, head, list);
}

/** Render the picker for the current template. */
export function buildUpfrontPicker(container, upfrontTools) {
  const selected = new Set((upfrontTools ?? []).map((s) => s.toLowerCase()));
  clear(container);

  if (sources.length === 0) {
    container.append(el('div', { class: 'tool-unknown' },
      'This agent has no MCP servers configured, so there is nothing to send.'));
    return;
  }
  container.append(...sources.map((entry) => serverBlock(entry, selected)));
}

/**
 * The form's answer.
 * `undefined` means "leave it to the default"; an array — including an empty
 * one — is an explicit choice.
 */
export function readUpfront(form) {
  if (form.elements['upfrontMode'].value === ALL) return undefined;
  return combineSelection(
    $$('input[name="upfrontServer"]:checked', form).map((i) => i.value),
    $$('input[name="upfrontTool"]:checked', form).map((i) => i.value),
  );
}

/** Put a template's choice back into the form. */
export function writeUpfront(form, upfrontTools) {
  form.elements['upfrontMode'].value = upfrontTools === undefined ? ALL : CHOOSE;
  buildUpfrontPicker($('#upfront-picker'), upfrontTools);
  syncMode(form);
}

/** Show or hide the picker to match the chosen mode. */
export function syncMode(form) {
  const choosing = form.elements['upfrontMode'].value === CHOOSE;
  $('#upfront-picker').hidden = !choosing;
  $('#upfront-hint').textContent = choosing
    ? 'Everything left unticked is still available — the agent finds it with search_tools.'
    : "Every tool from this agent's own servers is sent in every call.";
}
