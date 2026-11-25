// ── Listen mode: where speech goes, and when someone is speaking ─────────────
//
// No imports and no DOM, so both rules are directly testable; listen.js reads
// the page and the microphone and hands what it finds to these.

/**
 * Where something said now should go, or null when nothing is open to hear
 * it, in which case it is not even transcribed.
 *
 * A meeting on screen comes first: it sits over everything else. Then an
 * agent's own panel, opened by clicking it in the Agents section, which sits
 * over the sections. Then the Chat section with an agent chosen. Each goes to
 * the thread open there, or the agent's #general; `panel` is the id of the
 * conversation it was said into.
 *
 * @param {{
 *   meetingOpen: boolean,
 *   detailAgent?: string | null,
 *   detailThread?: string | null,
 *   view: string | null,
 *   chatAgent: string | null,
 *   chatThread: string | null,
 * }} page
 * @returns {{kind: 'meeting'}
 *   | {kind: 'agent', agent: string, thread: string, panel: string}
 *   | null}
 */
export function listenTarget(page) {
  if (page.meetingOpen) return { kind: 'meeting' };
  if (page.detailAgent) {
    return { kind: 'agent', agent: page.detailAgent, thread: page.detailThread || 'general', panel: 'agent-detail-threads' };
  }
  if (page.view === 'cli' && page.chatAgent) {
    return { kind: 'agent', agent: page.chatAgent, thread: page.chatThread || 'general', panel: 'chat-threads' };
  }
  return null;
}

/** The target in words, for the button's tooltip. */
export function describeTarget(target) {
  if (!target) return 'nothing is open to talk to: open a chat with an agent, or a meeting';
  if (target.kind === 'meeting') return 'talking to the meeting';
  return target.thread === 'general'
    ? `talking to ${target.agent}`
    : `talking to ${target.agent}, in the thread ${target.thread}`;
}

/** How loud, how long. Tuned by ear on a laptop microphone. */
export const VAD = {
  /** RMS level, 0–1, above which the room counts as someone speaking.
   *  listen.js replaces it with one suited to the room: see thresholdFor. */
  threshold: 0.025,
  /** Quiet for this long ends what was being said. */
  silenceMs: 1200,
  /** Anything shorter was a cough or a click, and is not sent. */
  minSpeechMs: 400,
  /** Nobody talks for longer than this in one go: cut it off and send it. */
  maxMs: 30_000,
};

/**
 * One step of telling speech from silence, from the microphone's level.
 *
 * @param {{speaking: boolean, startedAt: number, lastLoudAt: number}} at
 * @param {number} level  RMS level, 0–1
 * @param {number} now    ms
 * @returns {{at: {speaking: boolean, startedAt: number, lastLoudAt: number},
 *            event: 'start' | 'end' | 'discard' | null}}
 */
export function vadStep(at, level, now, opts = VAD) {
  const loud = level >= opts.threshold;
  if (!at.speaking) {
    return loud
      ? { at: { speaking: true, startedAt: now, lastLoudAt: now }, event: 'start' }
      : { at, event: null };
  }
  const lastLoudAt = loud ? now : at.lastLoudAt;
  const quietFor = now - lastLoudAt;
  const lasted = now - at.startedAt;
  if (quietFor < opts.silenceMs && lasted < opts.maxMs) {
    return { at: { ...at, lastLoudAt }, event: null };
  }
  const spoke = lastLoudAt - at.startedAt;
  return {
    at: { speaking: false, startedAt: 0, lastLoudAt: 0 },
    event: spoke >= opts.minSpeechMs ? 'end' : 'discard',
  };
}

export const QUIET = Object.freeze({ speaking: false, startedAt: 0, lastLoudAt: 0 });

// ── How loud counts as speaking, in this room ───────────────────────────────
//
// A fixed threshold suits one microphone in one room. Instead the background
// level is tracked while nobody is speaking, and speech is anything clearly
// above it, within limits: a silent room still needs a real voice, and a noisy
// one cannot set the bar so high that nobody is heard.

export const NOISE = {
  /** Speech is this many times the background level. */
  ratio: 3,
  /** Never lower than this, so a silent room does not trigger on breathing. */
  min: 0.008,
  /** Never higher than this, so a noisy room still hears a normal voice. */
  max: 0.04,
  /** How fast the background estimate rises; it falls at once. */
  rise: 0.02,
};

/** The background level, after hearing `level` while nobody was speaking. */
export function nextFloor(floor, level) {
  if (!(floor > 0) || level < floor) return level;
  return floor + (level - floor) * NOISE.rise;
}

/** How loud counts as speaking, over this background level. */
export function thresholdFor(floor) {
  return Math.min(NOISE.max, Math.max(NOISE.min, floor * NOISE.ratio));
}
