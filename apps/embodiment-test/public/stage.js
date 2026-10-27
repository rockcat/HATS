/**
 * The agent's face: avatar model, background and voice.
 *
 * The decision about where each of those comes from is in `stage-sources.js`;
 * this module is the part that touches the DOM, the renderer and the speakers.
 */

import { $, toastError, toastOk } from '/ui-kit/hats-ui.js';
import { clearAvatar, showAvatar } from '/ui-kit/avatar-stage.js';
import { sourcesFor } from '/stage-sources.js';

const LIBRARY = '/library/api/v1';
const SAMPLE_LINE = 'Hello. I am ready to help with your project.';

const ui = {
  canvas:     $('#avatar-canvas'),
  background: $('#stage-background'),
  hint:       $('#stage-hint'),
  source:     $('#stage-source'),
  voice:      $('#preview-voice'),
};

/** Avatar catalogue from the library, used to frame a model the API cannot. */
let catalogue = [];
/** What is on the stage now, so re-selecting the same agent reloads nothing. */
let shown = null;

export async function loadCatalogue() {
  try {
    const response = await fetch(`${LIBRARY}/avatars`);
    catalogue = response.ok ? (await response.json()).avatars ?? [] : [];
  } catch {
    catalogue = [];
  }
  return catalogue;
}

function setHint(text) {
  ui.hint.hidden = !text;
  ui.hint.textContent = text ?? '';
  ui.canvas.hidden = Boolean(text);
}

/**
 * Paint the stage for `row`. An avatar is a 4–18 MB model, so the same
 * selection is never reloaded.
 */
export async function showRow(row, runner) {
  ui.voice.disabled = !row?.identity?.voice;

  if (!row) {
    shown = null;
    clearAvatar();
    ui.background.hidden = true;
    ui.source.textContent = '';
    setHint('Select an agent');
    return;
  }

  const source = sourcesFor(row, catalogue, runner);
  ui.source.textContent = source.label;

  const token = `${row.key}|${source.avatarUrl}|${source.backgroundUrl}`;
  if (token === shown) return;
  shown = token;

  ui.background.hidden = !source.backgroundUrl;
  if (source.backgroundUrl) ui.background.src = source.backgroundUrl;

  if (!source.avatarUrl) {
    clearAvatar();
    setHint(`${row.name} has no avatar`);
    return;
  }

  setHint(null);
  try {
    await showAvatar(ui.canvas, { ...source.framing, url: source.avatarUrl });
  } catch (err) {
    clearAvatar();
    const known = catalogue.some((a) => a.file === row.identity.avatar);
    setHint(known
      ? `Could not load ${row.identity.avatar}: ${err.message}`
      : `${row.identity.avatar} is not in the avatar catalogue — pick another in the Agent Template Library`);
  }
}

/** A background file that no longer exists would otherwise show as a broken image. */
ui.background.addEventListener('error', () => { ui.background.hidden = true; });

// ── Voice ────────────────────────────────────────────────────────────────────

let audioCtx = null;

async function play(wav) {
  audioCtx ??= new AudioContext();
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  const source = audioCtx.createBufferSource();
  source.buffer = await audioCtx.decodeAudioData(await wav.arrayBuffer());
  source.connect(audioCtx.destination);
  source.start();
}

/**
 * Hear the agent. A deployed agent speaks through the Embodiment API, which is
 * what this harness is here to test; a library-only agent has no instance to
 * ask, so its voice is previewed through the library instead.
 */
export async function previewVoice(row, runner, text = SAMPLE_LINE) {
  if (!row?.identity?.voice) return;
  ui.voice.disabled = true;
  try {
    if (row.live) {
      const wav = await runner.speak(row.live.id, text);
      if (!(wav instanceof Blob)) throw new Error('No audio returned');
      await play(wav);
      toastOk(`${row.name} spoke via the Embodiment API`);
      return;
    }

    const response = await fetch(`${LIBRARY}/voices/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        voice: row.identity.voice,
        speakerName: row.identity.speakerName || undefined,
      }),
    });
    if (!response.ok) {
      throw new Error((await response.json().catch(() => ({}))).error ?? `Preview failed (${response.status})`);
    }
    await play(await response.blob());
    toastOk(`${row.name}'s voice, previewed from the library`);
  } catch (err) {
    toastError(err);
  } finally {
    ui.voice.disabled = false;
  }
}
