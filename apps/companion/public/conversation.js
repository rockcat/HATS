// ── The state of one conversation ─────────────────────────────────────────────
//
// No DOM and no network, so the awkward parts can be tested directly. The
// awkward parts are all the same shape: the runner is a second source of truth
// about what was said, and reconciling it with what this page already shows is
// where a chat window goes wrong.
//
// Two lessons carried over from the phone client, both of which looked like
// bugs in the UI and were really bugs here:
//
//  * The runner broadcasts the human's own message back to every listener. A
//    client that shows what you typed immediately — which it should, or
//    talking feels laggy — then sees it arrive again and shows it twice.
//  * A message from somewhere else, the dashboard say, matches nothing
//    pending and *is* news. Absorbing every echo blindly loses it.

/** How many unconfirmed messages to remember. Bounded, so a runner that never
 *  echoes cannot grow this for ever. */
const MAX_AWAITING_ECHO = 50;

export function emptyConversation() {
  return {
    /** Everything to show, oldest first. */
    messages: [],
    /** Said while disconnected, not yet accepted by the runner. */
    outbox: [],
    /** What we said and expect to hear come back. */
    awaitingEcho: [],
  };
}

const message = (role, content, extra = {}) => ({
  role,
  content,
  at: new Date().toISOString(),
  ...extra,
});

/**
 * Show what the user said, before the runner has confirmed it.
 *
 * Optimistic on purpose: it is what lets an offline message appear at all, and
 * what stops the window feeling dead while the request is in flight.
 */
export function saidByUser(state, text, { delivered = true } = {}) {
  const trimmed = text.trim();
  if (!trimmed) return state;

  return {
    ...state,
    messages: [...state.messages, message('user', trimmed, { pending: !delivered })],
    outbox: delivered ? state.outbox : [...state.outbox, trimmed],
    awaitingEcho: [...state.awaitingEcho, trimmed].slice(-MAX_AWAITING_ECHO),
  };
}

/**
 * A message arrived on the event stream.
 *
 * An echo of something this page already showed is absorbed — once. A second
 * identical message is not an echo, it is somebody saying the same thing
 * again, and dropping it would lose a real line of the conversation.
 */
export function arrived(state, { role, content, from }) {
  const text = (content ?? '').trim();
  if (!text) return state;

  if (role === 'user') {
    const at = state.awaitingEcho.indexOf(text);
    if (at >= 0) {
      // Ours, come back. Take it as confirmation rather than news.
      const awaitingEcho = [...state.awaitingEcho];
      awaitingEcho.splice(at, 1);
      return { ...state, awaitingEcho, messages: settleFirstPending(state.messages, text) };
    }
  }

  return {
    ...state,
    messages: [...state.messages, message(role ?? 'assistant', text, from ? { from } : {})],
  };
}

/** Mark the earliest matching pending message as delivered. */
function settleFirstPending(messages, text) {
  const at = messages.findIndex((m) => m.pending && m.content === text);
  if (at < 0) return messages;
  const copy = [...messages];
  copy[at] = { ...copy[at], pending: false };
  return copy;
}

/**
 * Everything queued while offline, in the order it was said.
 *
 * Order matters more than throughput here: half a conversation delivered out
 * of sequence reads as nonsense.
 */
export function pending(state) {
  return [...state.outbox];
}

/** One queued message went out. */
export function delivered(state, text) {
  const at = state.outbox.indexOf(text);
  if (at < 0) return state;
  const outbox = [...state.outbox];
  outbox.splice(at, 1);
  return { ...state, outbox, messages: settleFirstPending(state.messages, text) };
}

/** Nothing was sent after all — put it back as undelivered. */
export function failed(state) {
  return state;
}

/** Is there anything the agent has not heard yet? */
export const unsentCount = (state) => state.outbox.length;

/** The most recent thing the agent said, for speaking aloud. */
export function lastFromAgent(state) {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    if (state.messages[i].role === 'assistant') return state.messages[i];
  }
  return null;
}
