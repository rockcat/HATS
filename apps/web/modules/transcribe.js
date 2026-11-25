// ── Speech to text ───────────────────────────────────────────────────────────
//
// One recording in, its words out, through the runner's Whisper endpoint.
// Shared by the push-to-talk mic buttons and listen mode.

/**
 * The words in a recording.
 *
 * @param {Blob[]} chunks  what a MediaRecorder produced
 * @returns {Promise<{text: string} | {error: string}>} empty text when nothing was heard
 */
export async function transcribe(chunks) {
  const type = chunks[0]?.type || 'audio/webm';
  try {
    const res = await fetch('/api/speech/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': type },
      body: new Blob(chunks, { type }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: `Could not transcribe: ${data.error ?? `HTTP ${res.status}`}` };
    return { text: (data.text ?? '').trim() };
  } catch (err) {
    return { error: `Could not reach the transcription service: ${err?.message ?? err}` };
  }
}
