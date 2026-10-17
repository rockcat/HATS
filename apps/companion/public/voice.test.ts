import { describe, it, expect, beforeEach } from 'vitest';
// @ts-expect-error — a browser module; everything here is injected.
import {
  Hearing, Listener, canListen, canSpeak, sentences, speakOnDevice, stopSpeaking,
} from './voice.js';

/** Stands in for the Web Speech recogniser. */
class FakeRecognition {
  static last: FakeRecognition | null = null;
  continuous = false;
  interimResults = false;
  started = 0;
  stopped = 0;
  aborted = 0;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  throwOnStart = false;

  constructor() { FakeRecognition.last = this; }
  start() { this.started++; if (this.throwOnStart) throw new Error('mic busy'); }
  stop() { this.stopped++; }
  abort() { this.aborted++; }

  /** Pretend the browser heard something. */
  hear(text: string, isFinal = false) {
    this.onresult?.({ results: Object.assign([[{ transcript: text }]], { length: 1, 0: Object.assign([{ transcript: text }], { isFinal }) }) });
  }
  fail(error: string) { this.onerror?.({ error }); }
}

const scopeWith = (overrides: Record<string, unknown> = {}) => ({
  SpeechRecognition: FakeRecognition,
  ...overrides,
});

describe('what this browser can do', () => {
  it('finds a recogniser under either name', () => {
    expect(canListen({ SpeechRecognition: FakeRecognition })).toBe(true);
    expect(canListen({ webkitSpeechRecognition: FakeRecognition })).toBe(true);
  });

  it('admits when there is none', () => {
    // Firefox. Worth a real answer rather than failing at the first press.
    expect(canListen({})).toBe(false);
  });

  it('knows whether it can speak', () => {
    expect(canSpeak({ speechSynthesis: {} })).toBe(true);
    expect(canSpeak({})).toBe(false);
  });
});

describe('listening', () => {
  let heard: string[];
  let states: string[];
  let errors: string[];
  let listener: InstanceType<typeof Listener>;

  beforeEach(() => {
    heard = []; states = []; errors = [];
    FakeRecognition.last = null;
    listener = new Listener({
      scope: scopeWith(),
      onHeard: (text: string) => heard.push(text),
      onState: (s: string) => states.push(s),
      onError: (m: string) => errors.push(m),
    });
  });

  it('starts the recogniser', () => {
    listener.start();

    expect(FakeRecognition.last?.started).toBe(1);
    expect(listener.isListening).toBe(true);
    expect(states).toEqual([Hearing.listening]);
  });

  it('asks for partial results, so the box fills as you talk', () => {
    // A box that stays empty reads as a microphone that is not working.
    listener.start();
    expect(FakeRecognition.last?.interimResults).toBe(true);
  });

  it('reports what it heard as it settles', () => {
    listener.start();
    FakeRecognition.last!.hear('what is');
    FakeRecognition.last!.hear('what is the time', true);

    expect(heard).toEqual(['what is', 'what is the time']);
  });

  it('keeps what it heard when stopped mid-sentence', () => {
    listener.start();
    FakeRecognition.last!.hear('half a thought');

    expect(listener.stop()).toBe('half a thought');
  });

  it('does not let an empty final result erase what was heard', () => {
    // The recogniser sometimes settles on nothing after hearing something.
    listener.start();
    FakeRecognition.last!.hear('something real');
    FakeRecognition.last!.hear('', true);

    expect(listener.heard).toBe('something real');
  });

  it('ignores a result that arrives after we stopped', () => {
    // The platform delivers its last result a beat late, by which time the
    // caller has sent the sentence and cleared the box. This would refill it.
    listener.start();
    listener.stop();
    heard.length = 0;

    FakeRecognition.last!.hear('too late', true);
    expect(heard).toEqual([]);
  });

  it('ignores one that arrives after a cancel', () => {
    listener.start();
    listener.cancel();
    heard.length = 0;

    FakeRecognition.last!.hear('abandoned', true);
    expect(heard).toEqual([]);
    expect(listener.heard).toBe('');
  });

  it('ignores a second start while already listening', () => {
    listener.start();
    listener.start();

    expect(FakeRecognition.last?.started).toBe(1);
  });

  it('forgets the last utterance when a new one begins', () => {
    listener.start();
    FakeRecognition.last!.hear('first', true);
    listener.stop();
    listener.start();

    expect(listener.heard).toBe('');
  });

  it('passes through settling on the way down', () => {
    listener.start();
    states.length = 0;
    listener.stop();

    expect(states).toEqual([Hearing.settling, Hearing.idle]);
  });
});

describe('when it cannot hear', () => {
  const build = (scope: Record<string, unknown>, errors: string[]) =>
    new Listener({ scope, onError: (m: string) => errors.push(m) });

  it('says so in a browser with no recogniser', () => {
    const errors: string[] = [];
    build({}, errors).start();

    expect(errors[0]).toContain('no speech recognition');
    expect(errors[0]).toContain('Firefox');
  });

  it('explains a refused permission in terms of the fix', () => {
    const errors: string[] = [];
    const listener = build(scopeWith(), errors);
    listener.start();
    FakeRecognition.last!.fail('not-allowed');

    expect(errors[0]).toContain('permission');
    expect(listener.isListening).toBe(false);
  });

  it('does not report simply not having caught anything', () => {
    // "no-speech" fires constantly in a quiet room; surfacing it is noise.
    const errors: string[] = [];
    const listener = build(scopeWith(), errors);
    listener.start();
    FakeRecognition.last!.fail('no-speech');

    expect(errors).toEqual([]);
    expect(listener.isListening).toBe(false);
  });

  it('reports a recogniser that refuses to start', () => {
    // The microphone held by another tab, typically.
    class Refusing extends FakeRecognition {
      override start() { throw new Error('mic busy'); }
    }
    const errors: string[] = [];
    const listener = build({ SpeechRecognition: Refusing }, errors);

    listener.start();

    expect(errors[0]).toContain('Could not start listening');
    expect(errors[0]).toContain('mic busy');
    expect(listener.isListening).toBe(false);
  });
});

describe('breaking a reply into speakable pieces', () => {
  it('splits on sentence endings', () => {
    // Sentence at a time, so the first words start while the rest is still
    // being prepared.
    expect(sentences('Hello there. How are you? Good!'))
      .toEqual(['Hello there.', 'How are you?', 'Good!']);
  });

  it('splits on line breaks too', () => {
    expect(sentences('First line\nSecond line')).toEqual(['First line', 'Second line']);
  });

  it('drops empty pieces', () => {
    expect(sentences('One.\n\n\nTwo.')).toEqual(['One.', 'Two.']);
  });

  it('keeps a single sentence whole', () => {
    expect(sentences('Just the one')).toEqual(['Just the one']);
  });

  it('copes with nothing at all', () => {
    expect(sentences('')).toEqual([]);
    expect(sentences(null)).toEqual([]);
  });
});

describe('speaking', () => {
  class FakeUtterance {
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    voice: unknown = null;
    rate = 1;
    constructor(public text: string) {}
  }

  const scope = (behaviour: 'end' | 'error' | 'silent') => ({
    SpeechSynthesisUtterance: FakeUtterance,
    speechSynthesis: {
      spoken: [] as string[],
      cancelled: 0,
      speak(u: FakeUtterance) {
        this.spoken.push(u.text);
        if (behaviour === 'end') queueMicrotask(() => u.onend?.());
        if (behaviour === 'error') queueMicrotask(() => u.onerror?.());
      },
      cancel() { this.cancelled++; },
    },
  });

  it('says the words', async () => {
    const s = scope('end');
    await speakOnDevice('Hello there', { scope: s });

    expect(s.speechSynthesis.spoken).toEqual(['Hello there']);
  });

  it('settles even when the voice fails mid-sentence', async () => {
    // Otherwise the rest of the reply is never spoken.
    const s = scope('error');
    await expect(speakOnDevice('Hello', { scope: s })).resolves.toBeUndefined();
  });

  it('does not stall a browser that cannot speak', async () => {
    await expect(speakOnDevice('Hello', { scope: {} })).resolves.toBeUndefined();
  });

  it('says nothing for empty text', async () => {
    const s = scope('end');
    await speakOnDevice('   ', { scope: s });

    expect(s.speechSynthesis.spoken).toEqual([]);
  });

  it('can be cut off', () => {
    const s = scope('end');
    stopSpeaking(s);

    expect(s.speechSynthesis.cancelled).toBe(1);
  });

  it('does not throw when there was nothing to stop', () => {
    expect(() => stopSpeaking({})).not.toThrow();
  });
});
