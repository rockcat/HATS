// Lightweight timestamped logger.
// All server-side logging goes through here so every line carries a date/time.

function ts(): string {
  // "2026-04-05 14:32:45.123"
  return new Date().toISOString().replace('T', ' ').slice(0, 23);
}

export const log = {
  info:  (...args: unknown[]): void => console.log( `[${ts()}]`, ...args),
  warn:  (...args: unknown[]): void => console.warn( `[${ts()}]`, ...args),
  error: (...args: unknown[]): void => console.error(`[${ts()}]`, ...args),
};
