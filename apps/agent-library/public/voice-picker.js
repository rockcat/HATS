/**
 * Voice and speaker selection, matching the Team Runner's agent panel.
 *
 * The speaker list depends on the chosen voice — most Piper models are
 * single-speaker, and for those the second dropdown is hidden entirely rather
 * than offering a choice that does not exist.
 *
 * Listing voices only needs the model files, which the library reads itself —
 * no TTS process and no other service. Hearing a voice needs real synthesis,
 * which belongs to whichever service owns the Piper servers.
 */

import { $, el } from '/ui-kit/hats-ui.js';

let voices = [];

export function loadedVoices() { return voices; }

/** Populate the voice dropdown. Returns the list so callers can react to it. */
export function initVoices(form, list) {
  voices = list ?? [];
  const voiceSelect = form.elements['voice'];

  voiceSelect.replaceChildren(
    el('option', { value: '' }, voices.length ? '— no voice —' : 'no voices installed'),
    ...voices.map((v) => el('option', { value: v.name },
      v.speakers.length ? `${v.name}  (${v.speakers.length} speakers)` : v.name)),
  );
  voiceSelect.disabled = voices.length === 0;

  const hint = $('#voice-hint');
  if (hint) {
    hint.textContent = voices.length
      ? ''
      : 'No Piper voice models found. Add .onnx files to PIPER_VOICES_DIR.';
  }
  return voices;
}

/**
 * Rebuild the speaker dropdown for the selected voice.
 * `preferred` re-selects a stored speaker when the form is first populated.
 */
export function refreshSpeakers(form, preferred = '') {
  const voice = voices.find((v) => v.name === form.elements['voice'].value);
  const speakerSelect = form.elements['speakerName'];
  const speakers = voice?.speakers ?? [];

  speakerSelect.replaceChildren(
    el('option', { value: '' }, '(default)'),
    ...speakers.map((s) => el('option', { value: s.name }, s.name)),
  );
  // A single-speaker model has nothing to choose, so the control disappears.
  speakerSelect.hidden = speakers.length === 0;
  speakerSelect.value = speakers.some((s) => s.name === preferred) ? preferred : '';
}

export function initVoicePicker(form) {
  form.elements['voice'].addEventListener('change', () => refreshSpeakers(form));
}
