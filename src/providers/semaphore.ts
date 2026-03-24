/**
 * Async semaphore — limits concurrent operations and enforces a minimum
 * interval between each call starting (to avoid API rate-limit bursts).
 */
export class Semaphore {
  private queue: Array<() => void> = [];
  private running = 0;
  private nextStartAt = 0;  // timestamp: earliest time the next call may start

  constructor(
    private readonly concurrency: number,
    private readonly minIntervalMs: number = 0,
  ) {}

  async acquire(): Promise<void> {
    // Step 1: claim a concurrency slot (may queue here)
    if (this.running < this.concurrency) {
      this.running++;
    } else {
      await new Promise<void>((resolve) => this.queue.push(resolve));
      this.running++;
    }

    // Step 2: enforce minimum interval between call starts (slot already held)
    if (this.minIntervalMs > 0) {
      const wait = this.nextStartAt - Date.now();
      if (wait > 0) await sleep(wait);
      this.nextStartAt = Date.now() + this.minIntervalMs;
    }
  }

  release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) next();
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
