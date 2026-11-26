// ticket-description.js — a ticket's description, shown as Markdown and edited as text.
//
// The text box stays the one source: saving reads it whatever is showing, and
// the rendered view is drawn from it each time it is shown.

import { mdSafe } from './utils.js';

const input  = () => document.getElementById('edit-description');
const view   = () => document.getElementById('edit-description-view');
const toggle = () => document.getElementById('edit-description-toggle');

/** Show the description as Markdown, or as text to edit. */
export function showDescription(editing) {
  const text = input().value;
  if (!editing) {
    view().innerHTML = text.trim()
      ? mdSafe(text)
      : '<p class="ticket-desc-empty">No description — double-click or press Edit to add one.</p>';
  }
  view().hidden  = editing;
  input().hidden = !editing;
  toggle().textContent = editing ? 'Preview' : 'Edit';
  if (editing) input().focus();
}

/** Fill it for a ticket: a new or empty one opens ready to type into. */
export function setDescription(text) {
  input().value = text ?? '';
  showDescription(!input().value.trim());
}

export function initTicketDescription() {
  toggle().addEventListener('click', () => showDescription(input().hidden));
  view().addEventListener('dblclick', () => showDescription(true));
}
