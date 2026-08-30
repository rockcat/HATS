import { ProviderError } from './types.js';
import { log } from '../util/logger.js';

/**
 * Retry an async operation on rate-limit (429) errors with exponential backoff.
 * All other errors are thrown immediately.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 4,
  baseDelayMs = 2000,
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ProviderError && err.statusCode === 429 && attempt < maxRetries) {
        const jitter = Math.random() * 1000;
        const delay = baseDelayMs * Math.pow(2, attempt) + jitter;
        log.warn(`[Rate limit] waiting ${Math.round(delay / 1000)}s before retry ${attempt + 1}/${maxRetries}...`);
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
  /* istanbul ignore next */
  throw new Error('withRetry: unreachable');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
