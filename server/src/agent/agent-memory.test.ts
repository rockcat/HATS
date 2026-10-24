// What an agent remembers versus what the model is shown.
//
// They used to be the same number. The thread was capped at twenty messages
// and the cap deleted everything older, so Poppy forgot a whole conversation
// about the Xmas Randomiser an hour after having it — a few restarts had each
// added a "resume your task" exchange and pushed it out. These pin the split:
// the model sees a window, the agent keeps the thread.

import { describe, it, expect } from 'vitest';
import { Agent } from './agent.js';
import { HatType } from '../../../packages/core/src/hats/types.js';
import { MockProvider } from '../providers/mock.js';
import type { TeamMessage } from '../orchestrator/types.js';
import { contextWindow } from './agent-utils.js';

const say = (content: string): TeamMessage => ({
  id: `m-${Math.random()}`, ts: new Date().toISOString(),
  type: 'direct', from: 'human', to: 'Poppy', content,
});

function makeAgent(provider = new MockProvider({ content: 'Noted.' }), maxContextTokens?: number) {
  const agent = new Agent({
    identity: { name: 'Poppy', visualDescription: 'A test agent.' },
    hatType: [HatType.Blue],
    provider,
    model: 'mock-model',
    ...(maxContextTokens ? { maxContextTokens } : {}),
  });
  return { agent, provider };
}

const settle = () => new Promise((r) => setTimeout(r, 30));

async function converse(agent: Agent, lines: string[]) {
  for (const line of lines) {
    agent.receive(say(line));
    await settle();
  }
}

const general = (agent: Agent) => agent.getAllThreadHistories()['general'] ?? [];

describe('remembering', () => {
  it('keeps more than the context window', async () => {
    const { agent } = makeAgent();
    await converse(agent, Array.from({ length: 30 }, (_, n) => `message ${n}`));

    // 30 turns, two messages each. The old cap kept 20.
    expect(general(agent)).toHaveLength(60);
  });

  it('keeps the oldest message, not just the newest', async () => {
    const { agent } = makeAgent();
    await converse(agent, ['Every year I organise the Xmas Randomiser',
      ...Array.from({ length: 25 }, (_, n) => `later ${n}`)]);

    expect(JSON.stringify(general(agent))).toContain('Xmas Randomiser');
  });
});

describe('what the model is shown', () => {
  it('is a window, not the whole thread', async () => {
    const { agent, provider } = makeAgent();
    await converse(agent, Array.from({ length: 30 }, (_, n) => `message ${n}`));

    const last = provider.calls.at(-1)!;
    // Twenty from history, plus this turn's own message.
    expect(last.messages.length).toBeLessThanOrEqual(21);
  });

  it('always includes the message being answered', async () => {
    const { agent, provider } = makeAgent();
    await converse(agent, [...Array.from({ length: 30 }, (_, n) => `filler ${n}`), 'the question']);

    expect(JSON.stringify(provider.calls.at(-1)!.messages)).toContain('the question');
  });

  it('respects a token budget when one is set', async () => {
    const { agent, provider } = makeAgent(undefined, 50); // ~200 characters
    await converse(agent, Array.from({ length: 10 }, (_, n) => `${'x'.repeat(60)} ${n}`));

    const chars = provider.calls.at(-1)!.messages.reduce((n, m) => n + (m.content?.length ?? 0), 0);
    expect(chars).toBeLessThan(400);
    // …and still remembers all of it.
    expect(general(agent)).toHaveLength(20);
  });
});

describe('when the prompt is too long', () => {
  it('retries with less, and forgets nothing', async () => {
    // The overflow handler used to empty the thread to recover from one
    // oversized request.
    let first = true;
    const provider = new MockProvider({ content: 'Fine.' });
    const real = provider.complete.bind(provider);
    provider.complete = async (req) => {
      if (first && req.messages.length > 3) {
        first = false;
        const { ProviderError } = await import('../providers/types.js');
        throw new ProviderError('prompt is too long', 'mock', 400);
      }
      return real(req);
    };
    const { agent } = makeAgent(provider);

    await converse(agent, ['one', 'two', 'three', 'four']);

    // That the overflow actually happened. The first version of this test
    // passed the error's arguments in the wrong order, the handler never
    // matched, and the test passed without exercising anything.
    expect(first).toBe(false);
    const text = JSON.stringify(general(agent));
    for (const word of ['one', 'two', 'three', 'four']) expect(text).toContain(word);
  });
});

describe('when things were said', () => {
  it('does not restamp old messages on every save', async () => {
    // Every message in a restored thread used to carry the time of the last
    // save, so the thread could not say when anything happened.
    const { agent } = makeAgent();
    await converse(agent, ['first']);
    const firstAt = general(agent)[0]!.timestamp.getTime();

    await new Promise((r) => setTimeout(r, 25));
    await converse(agent, ['second']);

    expect(general(agent)[0]!.timestamp.getTime()).toBe(firstAt);
  });

  it('keeps timestamps that came back from disk', async () => {
    const { agent } = makeAgent();
    const then = '2026-10-24T10:19:07.000Z';
    agent.setAllThreadHistories({
      general: [
        { role: 'user', content: 'about the Xmas Randomiser', timestamp: then },
        { role: 'assistant', content: 'Understood.', timestamp: then },
      ],
    } as never);

    await converse(agent, ['and now?']);
    expect(general(agent)[0]!.timestamp.toISOString()).toBe(then);
  });
});

describe('contextWindow', () => {
  const msgs = (n: number) => Array.from({ length: n }, (_, i) => ({ content: `m${i}` }));

  it('takes the last N without a budget', () => {
    expect(contextWindow(msgs(30), undefined, 20).map((m) => m.content)[0]).toBe('m10');
  });

  it('never drops below two messages under a budget', () => {
    expect(contextWindow([{ content: 'x'.repeat(1000) }, { content: 'y'.repeat(1000) }], 1)).toHaveLength(2);
  });

  it('drops the oldest first', () => {
    const kept = contextWindow(msgs(10), 2); // 8 characters
    expect(kept.at(-1)!.content).toBe('m9');
    expect(kept.length).toBeLessThan(10);
  });
});
