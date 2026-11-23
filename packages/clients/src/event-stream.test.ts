import { describe, expect, it, vi } from 'vitest';
import { SseParser, watchEvents, type StreamEvent } from './event-stream.js';

describe('SseParser', () => {
  it('splits events however the chunks fall', () => {
    const parser = new SseParser();
    const text = ': connected\n\nevent: project_changed\ndata: {"id":"a"}\n\nevent: heartbeat\ndata: {}\n\n';
    const events: StreamEvent[] = [];
    for (let i = 0; i < text.length; i += 7) events.push(...parser.feed(text.slice(i, i + 7)));
    expect(events).toEqual([
      { event: 'project_changed', data: '{"id":"a"}' },
      { event: 'heartbeat', data: '{}' },
    ]);
  });

  it('reads Windows line endings and joins multi-line data', () => {
    const events = new SseParser().feed('data: one\r\ndata: two\r\n\r\n');
    expect(events).toEqual([{ event: 'message', data: 'one\ntwo' }]);
  });
});

/** A response whose body is `frames`, then ends. */
const streamOf = (...frames: string[]) => new Response(new ReadableStream({
  start(controller) {
    for (const frame of frames) controller.enqueue(new TextEncoder().encode(frame));
    controller.close();
  },
}), { headers: { 'Content-Type': 'text/event-stream' } });

describe('watchEvents', () => {
  it('delivers events, says when it is connected, and reconnects after a drop', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(streamOf('event: a\ndata: 1\n\n'))
      .mockRejectedValueOnce(new TypeError('refused'))
      .mockResolvedValue(streamOf('event: b\ndata: 2\n\n'));
    const events: string[] = [];
    const states: boolean[] = [];

    const watch = watchEvents('http://ps/api/v1/events', (e) => events.push(e.event), {
      fetchImpl, retryMs: 5, maxRetryMs: 5, onState: (up) => states.push(up),
    });
    await vi.waitFor(() => expect(events).toEqual(['a', 'b']));
    watch.stop();

    expect(states.slice(0, 4)).toEqual([true, false, false, true]);
  });

  it('stops retrying once stopped', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('refused'));
    const watch = watchEvents('http://ps/api/v1/events', () => {}, { fetchImpl, retryMs: 5, maxRetryMs: 5 });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    watch.stop();
    const calls = fetchImpl.mock.calls.length;
    await new Promise((r) => setTimeout(r, 30));
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(calls + 1);
  });
});
