/**
 * Working with other teams: how a team describes itself to other teams, and
 * which teams its agents may visit or it hosts. See docs/team-visits.md.
 *
 * Nothing is allowed until chosen here, and a visit needs both teams to
 * agree: this team listing the other under "may visit", and the other
 * listing this one under "hosts".
 */

import { clear, el } from '/ui-kit/hats-ui.js';
import { ANY, mergeVisitPolicy } from '/visit-policy-values.js';

/** A list of other projects to tick, with "Any team" first. */
function teamChecklist(name, others, chosen, onChange) {
  const picked = new Set(chosen.map((t) => t.toLowerCase()));
  const box = (value, label) => el('label', { class: 'visit-team' },
    el('input', { type: 'checkbox', name, value, checked: picked.has(value.toLowerCase()), onchange: onChange }),
    ' ', label);
  return el('div', { class: 'visit-teams' },
    box(ANY, 'Any team in this installation'),
    ...others.map((p) => box(p.id, p.name)));
}

/** Fill `container` with the form for `project`; `onChange` marks the project unsaved. */
export function renderVisitPolicy(container, project, allProjects, onChange) {
  const settings = project.settings ?? {};
  const visits = settings.visits ?? {};
  const others = allProjects.filter((p) => p.id !== project.id).sort((a, b) => a.name.localeCompare(b.name));

  clear(container).append(
    el('label', { class: 'field' },
      el('span', {}, 'Summary for other teams'),
      el('textarea', { name: 'visitSummary', rows: 2, maxlength: 400, placeholder: 'Defaults to the goal', oninput: onChange },
        settings.summary ?? '')),
    el('label', { class: 'field' },
      el('span', {}, 'Works on (tags, separated by commas)'),
      el('input', { name: 'visitTags', maxlength: 400, placeholder: 'billing, postgres, stripe',
        value: (settings.tags ?? []).join(', '), oninput: onChange })),
    el('div', { class: 'grid-2' },
      el('div', { class: 'field' },
        el('span', {}, 'This team\'s agents may visit'),
        teamChecklist('visitTo', others, visits.visitTo ?? [], onChange)),
      el('div', { class: 'field' },
        el('span', {}, 'This team hosts agents from'),
        teamChecklist('hostFrom', others, visits.hostFrom ?? [], onChange))),
    el('div', { class: 'grid-2' },
      el('label', { class: 'field' },
        el('span', {}, 'A visit here'),
        select('visitApproval', visits.approval ?? 'admin', [
          ['admin', 'waits for an admin of this team'], ['auto', 'goes ahead once allowed'],
        ], onChange)),
      el('label', { class: 'field' },
        el('span', {}, 'Visitors take home'),
        select('visitMemoryHome', visits.memoryHome ?? 'summary', [
          ['summary', 'only their result'], ['all', 'everything they learned'], ['none', 'nothing'],
        ], onChange))),
    el('label', { class: 'field' },
      el('span', {}, 'Longest visit, in hours (out of this team or into it)'),
      el('input', { name: 'visitMaxHours', type: 'number', min: 0.5, max: 168, step: 0.5,
        placeholder: 'No limit', value: visits.maxHours ?? '', oninput: onChange })),
  );
}

function select(name, value, options, onChange) {
  return el('select', { name, onchange: onChange },
    ...options.map(([v, label]) => el('option', { value: v, selected: v === value }, label)));
}

const ticked = (container, name) =>
  [...container.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);

/** `settings` with what the form says merged in, keeping the settings it does not touch. */
export function readVisitPolicy(container, settings = {}) {
  const value = (name) => container.querySelector(`[name="${name}"]`)?.value ?? '';
  return mergeVisitPolicy({
    summary: value('visitSummary'),
    tags: value('visitTags'),
    visitTo: ticked(container, 'visitTo'),
    hostFrom: ticked(container, 'hostFrom'),
    approval: value('visitApproval'),
    memoryHome: value('visitMemoryHome'),
    maxHours: value('visitMaxHours'),
  }, settings);
}
