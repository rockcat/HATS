// ── Hearing and speaking, in a browser ────────────────────────────────────────
//
// Both halves are the platform's: the Web Speech API for recognition and
// SpeechSynthesis for the voice. Nothing is sent anywhere for either, which is
// the same trade the phone client makes — a weaker transcriber than Whisper,
// in exchange for being instant, free and private.
//
// The browser's recogniser is less even than a phone's. Chrome implements it,
// Safari partially, Firefox not at all, so `canListen()` is a real question
// with a real answer rather than a formality.

/** What the listener is doing. */
export const Hearing = { idle: 'idle', listening: 'listening', settling: 'settling' };

/** Is there a recogniser in this browser at all? */
export function canListen(scope = globalThis) {
  return !!(scope.SpeechRecognition ?? scope.webkitSpeechRecognition);
}

/** Can this browser speak? */
export function canSpeak(scope = globalThis) {
  return !!scope.speechSynthesis;
}

/**
 * Listen until told to stop.
 *
 * Partial results are reported as they settle: recognition takes a second or
 * two to firm up, and a box that stays empty while you talk reads as a
 * microphone that is not working.
 */
export class Listener {
  /**
   * @param {object} [options]
   * @param {(text: string, isFinal: boolean) => void} [options.onHeard]
   * @param {(state: string) => void} [options.onState]
   * @param {(message: string) => void} [options.onError]
   * @param {() => void} [options.onEnd]  The recogniser stopped of its own accord.
   */
  constructor({ onHeard, onState, onError, onEnd, scope = globalThis } = {}) {
    this.onHeard = onHeard ?? null;
    this.onState = onState ?? null;
    this.onError = onError ?? null;
    this.onEnd = onEnd ?? null;
    this.scope = scope;
    this.state = Hearing.idle;
    this.heard = '';
    this.recognition = null;
    // A continuous session hands back every result it has ever produced, so
    // reading from zero would re-send the whole conversation each time. This
    // is where the current utterance starts.
    this.from = 0;
    this.seen = 0;
  }

  /**
   * Forget what has been heard so far; the next words start a new utterance.
   *
   * Needed because a continuous session keeps growing. Without it, hands-free
   * listening would send "hello", then "hello how are you", then "hello how
   * are you what is the time".
   */
  clear() {
    this.from = this.seen;
    this.heard = '';
  }

  get isListening() { return this.state !== Hearing.idle; }

  setState(next) {
    if (this.state === next) return;
    this.state = next;
    this.onState?.(next);
  }

  start() {
    if (this.isListening) return;
    const Recognition = this.scope.SpeechRecognition ?? this.scope.webkitSpeechRecognition;
    if (!Recognition) {
      this.onError?.('This browser has no speech recognition. Chrome has it; Firefox does not.');
      return;
    }

    this.heard = '';
    this.from = 0;
    this.seen = 0;
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      // The platform usually delivers its last result a beat after stop()
      // returns, and by then the caller has moved on — in the app, it has sent
      // the sentence and cleared the box, which this would silently refill.
      if (this.state === Hearing.idle) return;

      this.seen = event.results.length;
      let text = '';
      for (let i = this.from; i < event.results.length; i++) text += event.results[i][0].transcript;
      text = text.trim();
      // An empty final result does not erase a partial one: the recogniser
      // sometimes settles on nothing after hearing something.
      if (text) this.heard = text;
      this.onHeard?.(this.heard, !!event.results[event.results.length - 1]?.isFinal);
    };

    recognition.onerror = (event) => {
      const code = event?.error ?? '';
      this.setState(Hearing.idle);
      if (code === 'no-speech' || code === 'aborted') return; // not worth reporting
      this.onError?.(
        code === 'not-allowed'
          ? 'Microphone permission was refused, so I cannot hear you.'
          : `Speech recognition failed: ${code}`,
      );
    };

    recognition.onend = () => {
      this.setState(Hearing.idle);
      this.onEnd?.();
    };

    this.recognition = recognition;
    this.setState(Hearing.listening);
    try {
      recognition.start();
    } catch (err) {
      this.setState(Hearing.idle);
      this.onError?.(`Could not start listening: ${err?.message ?? err}`);
    }
  }

  /** Stop, and settle on what was heard. */
  stop() {
    if (!this.isListening) return this.heard;
    this.setState(Hearing.settling);
    try { this.recognition?.stop(); } catch { /* stopping is advisory */ }
    this.setState(Hearing.idle);
    return this.heard;
  }

  /** Give up and throw away what was heard. */
  cancel() {
    if (!this.isListening) return;
    try { this.recognition?.abort(); } catch { /* same */ }
    this.heard = '';
    this.setState(Hearing.idle);
  }
}

/** Where the voice comes from. */
export const SpeechMode = { device: 'device', server: 'server', off: 'off' };

/**
 * Split a reply into speakable pieces.
 *
 * Sentence at a time, so the first words start while the rest is still being
 * prepared. Long replies otherwise sit silent for seconds before anything
 * happens, which reads as the agent having failed.
 */
export function sentences(text) {
  return String(text ?? '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Say something out loud with the browser's own voice.
 *
 * Returns a promise that settles when it has finished, or immediately if this
 * browser cannot speak — a missing voice should not stall the conversation.
 */
export function speakOnDevice(text, { scope = globalThis, voice, rate = 1 } = {}) {
  const synth = scope.speechSynthesis;
  if (!synth || !text?.trim()) return Promise.resolve();

  return new Promise((resolve) => {
    const utterance = new scope.SpeechSynthesisUtterance(text);
    if (voice) utterance.voice = voice;
    utterance.rate = rate;
    // Resolve on error as well as on end: a voice that fails mid-sentence
    // must not leave the rest of the reply unspoken.
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    synth.speak(utterance);
  });
}

/** Stop talking immediately. */
export function stopSpeaking(scope = globalThis) {
  try { scope.speechSynthesis?.cancel(); } catch { /* nothing was speaking */ }
}
