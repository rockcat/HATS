// ── Panel helpers: mic buttons ───────────────────────────────────────────────
//
// Sections and the menu that switches between them live in nav.js.

import { appendCLILine } from './cli.js';
import { micAction } from './mic-action.js';

// ── Mic buttons ─────────────────────────────────────────────────────────────
//
// Hold to talk, or click to start and click again to stop. It used to be
// hold-only, which meant a click recorded nothing, produced no chunks, and
// returned in silence — indistinguishable from a dead button, and a click is
// what most people try first.
//
// Every failure is now said out loud in the CLI pane. They were all
// console.warn before, so a refused microphone, a missing OPENAI_API_KEY or
// a Whisper error all looked identical: nothing happening.


export function initMicBtn(btnId, inputId) {
  const btn = document.getElementById(btnId);
  const inp = document.getElementById(inputId);
  if (!btn || !inp) return;

  let mediaRecorder = null;
  let chunks        = [];
  let pressedAt     = 0;
  /** Set by a click-start, so the matching release does not stop it. */
  let latched       = false;

  const setState = (s) => {
    btn.classList.toggle('recording',  s === 'recording');
    btn.classList.toggle('processing', s === 'processing');
    btn.disabled = s === 'processing';
    btn.title    = s === 'recording'  ? 'Listening — click to stop'
                 : s === 'processing' ? 'Transcribing…'
                 : 'Speak: hold, or click to start and click again to stop';
  };
  setState('idle');

  const say = (text) => appendCLILine(text, 'cli-error');

  const startRecording = async () => {
    chunks = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      mediaRecorder.start();
      setState('recording');
    } catch (err) {
      // Nearly always a refused permission, and the browser only asks once.
      say(`Microphone unavailable: ${err?.message ?? err}. Check the site's microphone permission.`);
      setState('idle');
    }
  };

  const stopAndTranscribe = async () => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') { setState('idle'); return; }
    setState('processing');

    await new Promise(resolve => {
      mediaRecorder.onstop = resolve;
      mediaRecorder.stop();
      mediaRecorder.stream.getTracks().forEach(t => t.stop());
    });

    if (chunks.length === 0) {
      say('Nothing was recorded — hold the mic while you speak, or click it to start and stop.');
      setState('idle');
      mediaRecorder = null;
      return;
    }

    try {
      const mimeType = chunks[0].type || 'audio/webm';
      const blob     = new Blob(chunks, { type: mimeType });
      const res      = await fetch('/api/speech/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': mimeType },
        body: blob,
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok)          say(`Could not transcribe: ${data.error ?? `HTTP ${res.status}`}`);
      else if (!data.text)  say('Nothing was heard in that recording.');
      else {
        const sep = inp.value && !inp.value.endsWith(' ') ? ' ' : '';
        inp.value += sep + data.text;
        inp.focus();
      }
    } catch (err) {
      say(`Could not reach the transcription service: ${err?.message ?? err}`);
    }

    setState('idle');
    mediaRecorder = null;
    chunks        = [];
  };

  /** A press starts recording, whether it turns out to be a hold or a click. */
  const press = (e) => {
    e.preventDefault();
    if (btn.disabled) return;
    const recording = mediaRecorder?.state === 'recording';
    if (micAction('press', { recording, heldMs: 0, latched }) === 'stop') {
      latched = false;
      stopAndTranscribe();
      return;
    }
    pressedAt = Date.now();
    latched   = false;
    startRecording();
  };

  /** A release stops it, unless it came too quickly to have been a hold. */
  const release = () => {
    const action = micAction('release', {
      recording: mediaRecorder?.state === 'recording',
      heldMs: Date.now() - pressedAt,
      latched,
    });
    if (action === 'latch') latched = true;
    else if (action === 'stop') stopAndTranscribe();
  };

  btn.addEventListener('mousedown', press);
  window.addEventListener('mouseup', release);
  btn.addEventListener('touchstart', press, { passive: false });
  window.addEventListener('touchend', release);
}
export function initMicButtons() {
  initMicBtn('cli-mic-btn',     'cli-input');
  initMicBtn('meeting-mic-btn', 'meeting-input');
}
