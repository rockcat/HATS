import { describe, it, expect } from 'vitest';
// @ts-expect-error — a browser module with no imports, so it loads here.
import {
  STATUS_MAX, arrived, delivered, emptyConversation, lastFromAgent, pending, saidByUser,
  statusLine, unsentCount,
} from './conversation.js';

const user = (text: string) => ({ role: 'user', content: text });
const agent = (text: string) => ({ role: 'assistant', content: text });

describe('saying something', () => {
  it('shows it straight away, before the runner has confirmed', () => {
    // Waiting for the round trip makes the window feel dead.
    const state = saidByUser(emptyConversation(), 'hello');

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].content).toBe('hello');
    expect(state.messages[0].pending).toBe(false);
  });

  it('marks it pending when it could not be sent', () => {
    const state = saidByUser(emptyConversation(), 'hello', { delivered: false });

    expect(state.messages[0].pending).toBe(true);
    expect(unsentCount(state)).toBe(1);
  });

  it('ignores an empty message', () => {
    expect(saidByUser(emptyConversation(), '   ').messages).toHaveLength(0);
  });

  it('trims what it stores', () => {
    expect(saidByUser(emptyConversation(), '  hello  ').messages[0].content).toBe('hello');
  });

  it('does not mutate the state it was given', () => {
    const before = emptyConversation();
    saidByUser(before, 'hello');
    expect(before.messages).toHaveLength(0);
  });
});

describe('the runner echoing our own message back', () => {
  it('shows it once, not twice', () => {
    // The runner broadcasts the human's message to every listener, including
    // the page that just sent it.
    let state = saidByUser(emptyConversation(), 'hello');
    state = arrived(state, user('hello'));

    expect(state.messages).toHaveLength(1);
  });

  it('takes the echo as confirmation that it was heard', () => {
    let state = saidByUser(emptyConversation(), 'hello', { delivered: false });
    expect(state.messages[0].pending).toBe(true);

    state = arrived(state, user('hello'));
    expect(state.messages[0].pending).toBe(false);
  });

  it('absorbs one echo per identical message, not all of them', () => {
    // Saying the same thing twice is a real thing people do.
    let state = saidByUser(emptyConversation(), 'yes');
    state = saidByUser(state, 'yes');
    state = arrived(state, user('yes'));
    state = arrived(state, user('yes'));

    expect(state.messages).toHaveLength(2);
  });

  it('shows a third identical message, which cannot have been ours', () => {
    let state = saidByUser(emptyConversation(), 'yes');
    state = arrived(state, user('yes'));
    state = arrived(state, user('yes'));

    expect(state.messages).toHaveLength(2);
  });

  it('still shows a message typed somewhere else', () => {
    // From the dashboard, say. It matches nothing pending and is real news.
    let state = saidByUser(emptyConversation(), 'hello');
    state = arrived(state, user('something else entirely'));

    expect(state.messages).toHaveLength(2);
  });

  it('leaves an agent reply alone, whatever it says', () => {
    let state = saidByUser(emptyConversation(), 'hello');
    state = arrived(state, agent('hello'));

    expect(state.messages).toHaveLength(2);
    expect(state.messages[1].role).toBe('assistant');
  });

  it('ignores an empty frame', () => {
    const state = arrived(emptyConversation(), agent('   '));
    expect(state.messages).toHaveLength(0);
  });
});

describe('what is waiting to go out', () => {
  it('keeps the order it was said in', () => {
    // Half a conversation delivered out of sequence reads as nonsense.
    let state = saidByUser(emptyConversation(), 'first', { delivered: false });
    state = saidByUser(state, 'second', { delivered: false });

    expect(pending(state)).toEqual(['first', 'second']);
  });

  it('clears one as it goes, and settles the message', () => {
    let state = saidByUser(emptyConversation(), 'first', { delivered: false });
    state = delivered(state, 'first');

    expect(unsentCount(state)).toBe(0);
    expect(state.messages[0].pending).toBe(false);
  });

  it('ignores a delivery for something not queued', () => {
    const state = delivered(emptyConversation(), 'never said');
    expect(state.messages).toHaveLength(0);
  });

  it('counts nothing when everything is through', () => {
    expect(unsentCount(emptyConversation())).toBe(0);
  });

  it('does not hand out its own array to be mutated', () => {
    const state = saidByUser(emptyConversation(), 'a', { delivered: false });
    pending(state).push('tampered');

    expect(unsentCount(state)).toBe(1);
  });
});

describe('what the agent last said', () => {
  it('finds the most recent assistant line', () => {
    let state = arrived(emptyConversation(), agent('first'));
    state = saidByUser(state, 'something');
    state = arrived(state, agent('second'));

    expect(lastFromAgent(state).content).toBe('second');
  });

  it('is nothing when the agent has not spoken', () => {
    expect(lastFromAgent(saidByUser(emptyConversation(), 'hello'))).toBeNull();
  });
});

describe('not growing without bound', () => {
  it('forgets very old unconfirmed messages', () => {
    // A runner that never echoes must not grow this for ever.
    let state = emptyConversation();
    for (let i = 0; i < 80; i++) state = saidByUser(state, `message ${i}`);

    expect(state.awaitingEcho.length).toBeLessThanOrEqual(50);
    expect(state.awaitingEcho).toContain('message 79');
  });
});

describe('the echo racing the send', () => {
  it('shows it once when the echo beats the POST back', () => {
    // The runner broadcasts the moment it records the message, so the event
    // can land while the POST is still in flight. Registering it as ours
    // before sending is what makes the order not matter — the first version
    // of this app sent first, and every message appeared twice.
    let state = saidByUser(emptyConversation(), 'hello', { delivered: false });
    state = arrived(state, user('hello'));          // echo arrives first
    state = delivered(state, 'hello');              // POST returns after

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].pending).toBe(false);
    expect(unsentCount(state)).toBe(0);
  });

  it('shows it once when the POST returns first', () => {
    let state = saidByUser(emptyConversation(), 'hello', { delivered: false });
    state = delivered(state, 'hello');
    state = arrived(state, user('hello'));

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].pending).toBe(false);
  });

  it('settles the message even if the echo never comes', () => {
    // Some runners do not echo at all; the message must not stay greyed out.
    let state = saidByUser(emptyConversation(), 'hello', { delivered: false });
    state = delivered(state, 'hello');

    expect(state.messages[0].pending).toBe(false);
  });
});

describe('the status line under the name', () => {
  it('shows a short activity, which is a real status', () => {
    expect(statusLine('working', 'Messaging Rhoda…')).toBe('Messaging Rhoda…');
    expect(statusLine('idle', 'Task complete')).toBe('Task complete');
  });

  it('falls back to the state when the activity is the whole reply', () => {
    // The runner sets activity to the message content when an agent responds,
    // which put a second copy of every answer above the avatar.
    const reply = 'Yes, I looked into the lease options and the Polestar 2 '
      + 'works out cheaper over three years than the alternatives.';
    expect(statusLine('working', reply)).toBe('working');
  });

  it('rejects a short activity that spans lines', () => {
    expect(statusLine('idle', 'one\ntwo')).toBe('idle');
  });

  it('shows the state when there is no activity at all', () => {
    expect(statusLine('idle', '')).toBe('idle');
    expect(statusLine('idle', undefined)).toBe('idle');
  });

  it('says nothing rather than undefined when it knows nothing', () => {
    expect(statusLine(undefined, undefined)).toBe('');
  });

  it('takes an activity right on the limit', () => {
    expect(statusLine('idle', 'x'.repeat(STATUS_MAX))).toBe('x'.repeat(STATUS_MAX));
    expect(statusLine('idle', 'x'.repeat(STATUS_MAX + 1))).toBe('idle');
  });
});
