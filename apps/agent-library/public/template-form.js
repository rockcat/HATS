/** Mapping between the editor form and an AgentTemplate document. */

import { $$, HAT_TYPES, el } from '/ui-kit/hats-ui.js';

const csv = (value) => (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const number = (value) => (value === '' || value === null ? undefined : Number(value));
const trimmed = (value) => (value ?? '').trim() || undefined;

export function buildHatCheckboxes(container) {
  container.replaceChildren(...HAT_TYPES.map((hat) => el('label', {},
    el('input', { type: 'checkbox', value: hat, name: 'hats' }),
    el('span', { class: `hat hat-${hat}` }),
    hat,
  )));
}

export function selectedHats(form) {
  return $$('input[name="hats"]:checked', form).map((input) => input.value);
}

/** Form fields → the AgentTemplateInput accepted by the API. */
export function readForm(form) {
  const data = new FormData(form);
  const value = (name) => trimmed(data.get(name));
  const hats = selectedHats(form);

  const limits = {
    maxContextTokens: number(data.get('maxContextTokens')),
    maxCostPerHour: number(data.get('maxCostPerHour')),
  };
  const enabledMcpServers = csv(data.get('enabledMcpServers'));
  const tags = csv(data.get('tags'));

  const input = {
    name: value('name') ?? '',
    description: value('description'),
    hats: hats.length ? hats : ['none'],
    identity: {
      visualDescription: value('visualDescription') ?? 'a focused, capable team member',
      specialisation: value('specialisation'),
      backstory: value('backstory'),
      email: value('email'),
      avatar: value('avatar'),
      background: value('background'),
      voice: value('voice'),
      speakerName: value('speakerName'),
    },
    model: {
      provider: value('provider') ?? 'anthropic',
      model: value('model') ?? '',
    },
  };

  // Omit empty optional objects entirely — the schema forbids stray nulls.
  const definedLimits = Object.fromEntries(Object.entries(limits).filter(([, v]) => v !== undefined));
  if (Object.keys(definedLimits).length) input.limits = definedLimits;
  if (enabledMcpServers.length) input.tools = { enabledMcpServers };
  if (tags.length) input.tags = tags;

  for (const key of Object.keys(input.identity)) {
    if (input.identity[key] === undefined) delete input.identity[key];
  }
  for (const key of Object.keys(input)) {
    if (input[key] === undefined) delete input[key];
  }
  return input;
}

/** An AgentTemplate → the form fields. */
export function writeForm(form, template) {
  const set = (name, value) => {
    const field = form.elements[name];
    if (field) field.value = value ?? '';
  };

  set('name', template.name);
  set('description', template.description);
  set('specialisation', template.identity?.specialisation);
  set('visualDescription', template.identity?.visualDescription);
  set('backstory', template.identity?.backstory);
  set('email', template.identity?.email);
  set('avatar', template.identity?.avatar);
  set('background', template.identity?.background);
  set('voice', template.identity?.voice);
  set('speakerName', template.identity?.speakerName);
  set('provider', template.model?.provider ?? 'anthropic');
  set('model', template.model?.model);
  set('maxContextTokens', template.limits?.maxContextTokens);
  set('maxCostPerHour', template.limits?.maxCostPerHour);
  set('enabledMcpServers', (template.tools?.enabledMcpServers ?? []).join(', '));
  set('tags', (template.tags ?? []).join(', '));
  set('persona', '');

  const hats = new Set(template.hats ?? ['none']);
  for (const input of $$('input[name="hats"]', form)) input.checked = hats.has(input.value);
}

/** Blank template used when the user clicks "New". */
export function emptyTemplate(defaultModel) {
  return {
    name: 'New agent',
    hats: ['none'],
    identity: { visualDescription: 'a focused, capable team member' },
    model: defaultModel ?? { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
  };
}

/** Apply a persona seed over the current form without discarding model settings. */
export function applyPersona(form, persona) {
  if (!persona) return;
  form.elements['name'].value = persona.name ?? '';
  form.elements['visualDescription'].value = persona.visualDescription ?? '';
  form.elements['specialisation'].value = persona.specialisation ?? '';
  form.elements['backstory'].value = persona.backstory ?? '';
}
