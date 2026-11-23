/**
 * Listening to a server-sent event stream, and keeping it open.
 *
 * Node's fetch has no EventSource, so this reads the stream itself. A stream
 * that drops, or never opens, is retried with a growing delay, and the
 * caller is told whether it is connected so it can fall back to polling.
 */

export interface StreamEvent {
  /** The `event:` line, or "message" when there was none. */
  event: string;
  /** The `data:` lines, joined. */
  data: string;
}

/** Splits a server-sent event stream into events, however its chunks arrive. */
export class SseParser {
  private buffer = '';

  feed(chunk: string): StreamEvent[] {
    this.buffer += chunk.replace(/\r\n/g, '\n');
    const events: StreamEvent[] = [];
    let end: number;
    while ((end = this.buffer.indexOf('\n\n')) >= 0) {
      const frame = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      let event = 'message';
      const data: string[] = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith(':')) continue;          // a comment, such as ": connected"
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (data.length) events.push({ event, data: data.join('\n') });
    }
    return events;
  }
}

export interface WatchOptions {
  fetchImpl?: typeof fetch;
  /** Told when the stream opens and when it drops. */
  onState?: (connected: boolean) => void;
  /** First retry delay; doubles up to `maxRetryMs`. */
  retryMs?: number;
  maxRetryMs?: number;
}

export interface Watch {
  stop(): void;
}

/** Call `onEvent` for every event on the stream at `url` until stopped. */
export function watchEvents(url: string, onEvent: (event: StreamEvent) => void, o: WatchOptions = {}): Watch {
  const fetchImpl = o.fetchImpl ?? fetch;
  const firstRetry = o.retryMs ?? 1_000;
  const maxRetry = o.maxRetryMs ?? 30_000;
  const controller = new AbortController();
  let stopped = false;
  let retry = firstRetry;

  const run = async (): Promise<void> => {
    while (!stopped) {
      try {
        const res = await fetchImpl(url, { signal: controller.signal, headers: { Accept: 'text/event-stream' } });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        o.onState?.(true);
        retry = firstRetry;
        const parser = new SseParser();
        const decoder = new TextDecoder();
        const reader = res.body.getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          for (const event of parser.feed(decoder.decode(value, { stream: true }))) onEvent(event);
        }
      } catch {
        // Dropped or refused: retried below, unless stopping.
      }
      if (stopped) return;
      o.onState?.(false);
      await new Promise((r) => setTimeout(r, retry).unref?.());
      retry = Math.min(retry * 2, maxRetry);
    }
  };
  void run();

  return {
    stop() {
      stopped = true;
      controller.abort();
    },
  };
}
