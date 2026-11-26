// ── Whether an agent is speaking out loud ───────────────────────────────────
//
// Agents speak through two players: voice.js for the agent on the dashboard,
// and meeting.js for a meeting. Both say here when a clip starts and ends, so
// listen mode can stop its ears while an agent talks and not send an agent
// its own words back.

/** How long after a clip ends the room may still be ringing with it. */
export const TAIL_MS = 600;

let playing = 0;
let lastEndedAt = 0;

export function speechStarted() {
  playing++;
}

export function speechEnded(now = Date.now()) {
  playing = Math.max(0, playing - 1);
  lastEndedAt = now;
}

export function isSpeechPlaying(now = Date.now()) {
  return playing > 0 || now - lastEndedAt < TAIL_MS;
}
