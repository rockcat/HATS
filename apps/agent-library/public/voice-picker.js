/**
 * Voice and speaker selection, matching the Team Runner's agent panel.
 *
 * The speaker list depends on the chosen voice — most Piper models are
 * single-speaker, and for those the second dropdown is hidden entirely rather
 * than offering a choice that does not exist.
 *
 * Listing voices only needs the model files, which the library reads itself —
 * no TTS process and no other service, so the dropdowns always work. Hearing
 * one needs real synthesis, which belongs to the Speech Service; that button
 * is the only part of this editor that depends on anything else running.
 */

import { $, el, toastError } from '/ui-kit/hats-ui.js';

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

let audioCtx = null;

/**
 * Play a sample. Synthesis belongs to the Speech Service; the library asks its
 * own server, which forwards. With no Speech Service the picker still works —
 * only the sample is unavailable, and it says so.
 */
async function preview(form) {
  const button = $('#preview-voice');
  const voice = form.elements['voice'].value;
  if (!voice) { toastError(new Error('Choose a voice first')); return; }

  const original = button.textContent;
  button.disabled = true;
  button.textContent = '…';
  try {
    const res = await fetch('/api/v1/voices/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voice, speakerName: form.elements['speakerName'].value || undefined }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `Preview failed (${res.status})`);
    }
    audioCtx ??= new AudioContext();
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    const buffer = await audioCtx.decodeAudioData(await res.arrayBuffer());
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    source.start();
  } catch (err) {
    toastError(err);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

export function initVoicePicker(form) {
  form.elements['voice'].addEventListener('change', () => refreshSpeakers(form));
  $('#preview-voice').addEventListener('click', () => void preview(form));
}
