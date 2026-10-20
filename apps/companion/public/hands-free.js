// ── Listening without being asked to ──────────────────────────────────────────
//
// Push-to-talk makes you press a button before every sentence, which is fine
// for dictation and wrong for a conversation. This keeps the microphone open
// and decides for itself when you have finished saying something.
//
// Three problems have to be solved for that to be bearable, and all three are
// the reason this is a module rather than a flag:
//
//  * **Knowing when you stopped.** `isFinal` is not it. The recogniser marks a
//    result final whenever it is confident, which happens several times inside
//    one spoken sentence — sending on it chops you off mid-thought. What
//    actually means "finished" is a pause, so the rule here is silence for a
//    beat after the last thing heard.
//
//  * **Not answering itself.** The reply comes out of the same speakers the
//    microphone is pointed at. Left alone the agent hears its own voice, takes
//    it for the next thing you said, and talks to itself until you close the
//    tab. So the microphone is shut while it speaks — unless the voice is off,
//    in which case there is nothing to hear and you can interrupt freely.
//
//  * **Not sending noise.** A cough, a chair, "um" — the recogniser offers all
//    of them. Sending them wakes the agent for nothing, so an utterance with no
//    actual words in it is dropped.
//
// Everything here takes its clock by injection so the behaviour can be tested
// without waiting in real seconds for a pause.

/** How long a pause means "finished talking", in milliseconds. */
export const DEFAULT_SETTLE_MS = 1100;

/**
 * Sounds people make that are not words.
 *
 * Deliberately short. "yes", "no", "ok" and "stop" are complete, meaningful
 * replies to an agent and must get through — the test for noise is whether it
 * is lexical at all, not whether it is interesting.
 */
const NOISE = new Set([
  'uh', 'um', 'er', 'erm', 'ah', 'eh', 'oh', 'mm', 'mmm', 'hm', 'hmm', 'huh', 'mhm',
]);

/** Is this worth waking the agent for? */
export function worthSending(text) {
  const trimmed = String(text ?? '').trim();
  if (trimmed.length < 2) return false;

  const words = trimmed.toLowerCase()
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return false;
  return !words.every((word) => NOISE.has(word));
}

/** What hands-free listening is doing, for the benefit of the UI. */
export const Mode = {
  /** Switched off. The mic button is push-to-talk again. */
  off: 'off',
  /** Microphone open, waiting for you. */
  open: 'open',
  /** You are talking; nothing has been sent yet. */
  hearing: 'hearing',
  /** Deliberately deaf, because the agent is speaking. */
  held: 'held',
};

/**
 * Keeps the microphone open and sends whole utterances.
 *
 * Owns no DOM and no timers of its own beyond the two it is handed, so the
 * whole of the awkward part — when to send, when to go deaf — is testable.
 */
export class HandsFree {
  /**
   * @param {object} options
   * @param {{start(): void, stop(): string, cancel(): void, clear(): void, isListening: boolean}} options.listener
   * @param {(text: string) => void} options.onUtterance  Called with a finished sentence.
   * @param {(mode: string) => void} [options.onMode]
   * @param {number} [options.settleMs]
   * @param {{setTimeout: Function, clearTimeout: Function}} [options.timers]
   */
  constructor({ listener, onUtterance, onMode, settleMs = DEFAULT_SETTLE_MS, timers = globalThis }) {
    this.listener = listener;
    this.onUtterance = onUtterance;
    this.onMode = onMode ?? null;
    this.settleMs = settleMs;
    this.timers = timers;

    this.on = false;
    this.heldCount = 0;
    this.timer = null;
    this.pending = '';
    this.mode = Mode.off;
  }

  get enabled() { return this.on; }
  get held() { return this.heldCount > 0; }

  setMode(next) {
    if (this.mode === next) return;
    this.mode = next;
    this.onMode?.(next);
  }

  enable() {
    if (this.on) return;
    this.on = true;
    this.heldCount = 0;
    this.open();
  }

  disable() {
    if (!this.on) return;
    this.on = false;
    this.heldCount = 0;
    this.clearTimer();
    this.pending = '';
    this.listener.cancel();
    this.setMode(Mode.off);
  }

  toggle() {
    if (this.on) this.disable(); else this.enable();
    return this.on;
  }

  /** Open the microphone, unless something is holding it shut. */
  open() {
    if (!this.on || this.held) return;
    this.listener.clear();
    if (!this.listener.isListening) this.listener.start();
    this.setMode(Mode.open);
  }

  /**
   * Go deaf for a moment.
   *
   * Counted rather than a boolean: speaking a reply one sentence at a time
   * takes several holds, and a plain flag would be cleared by the first
   * sentence finishing while the rest was still to come.
   */
  hold() {
    this.heldCount += 1;
    if (!this.on || this.heldCount > 1) return;
    this.clearTimer();
    // Thrown away rather than kept: whatever is half-heard at the moment the
    // agent starts talking is as likely to be the start of its own voice.
    this.pending = '';
    this.listener.cancel();
    this.setMode(Mode.held);
  }

  release() {
    if (this.heldCount === 0) return;
    this.heldCount -= 1;
    if (this.heldCount === 0) this.open();
  }

  /**
   * Throw away the sentence in progress, but keep listening.
   *
   * For when the user has taken over by typing: without it the words they
   * just spoke arrive a beat later as a second message.
   */
  dismiss() {
    this.clearTimer();
    this.pending = '';
    this.listener.clear();
    if (this.on && !this.held) this.setMode(Mode.open);
  }

  /** Something was heard. Restarts the clock on the pause that ends a sentence. */
  heard(text, isFinal = false) {
    if (!this.on || this.held) return;

    const trimmed = String(text ?? '').trim();
    if (!trimmed) return;

    this.pending = trimmed;
    this.setMode(Mode.hearing);

    // A final result still waits: the recogniser marks several finals inside
    // one spoken sentence, and sending on the first cuts people off.
    this.clearTimer();
    this.timer = this.timers.setTimeout(() => this.settle(), this.settleMs);
    void isFinal;
  }

  /** The pause ran long enough. Send it. */
  settle() {
    this.timer = null;
    const text = this.pending;
    this.pending = '';
    if (!this.on) return;

    // Clear before dispatching, so anything said during the round trip is
    // heard as a new sentence rather than appended to the one just sent.
    this.listener.clear();
    this.setMode(this.held ? Mode.held : Mode.open);

    if (!worthSending(text)) return;
    this.onUtterance(text);
  }

  /**
   * The recogniser stopped by itself.
   *
   * Chrome ends a continuous session after a long enough silence, and on a
   * network blip. Left alone that is a microphone that silently stops working
   * after a few minutes, so it is simply started again.
   */
  recogniserEnded() {
    if (!this.on || this.held) return;
    this.open();
  }

  clearTimer() {
    if (this.timer === null) return;
    this.timers.clearTimeout(this.timer);
    this.timer = null;
  }
}
