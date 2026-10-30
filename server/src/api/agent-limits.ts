/**
 * A project agent's own limits, as the Configure panel sends them. A copy
 * starts with its template's limits and is changed here, not in the library.
 *
 * Each is a positive number, or null or empty to remove it. A field left out
 * is left as it is.
 */

export interface LimitsPatch {
  maxCostPerHour?: number | undefined;
  maxContextTokens?: number | undefined;
}

function limit(name: string, value: unknown): number | undefined {
  if (value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number, or empty for no limit`);
  return n;
}

/** The changes asked for: a key present means set it, undefined meaning no limit. */
export function parseLimits(body: Record<string, unknown>): LimitsPatch {
  const patch: LimitsPatch = {};
  if ('maxCostPerHour' in body) patch.maxCostPerHour = limit('maxCostPerHour', body['maxCostPerHour']);
  if ('maxContextTokens' in body) {
    const tokens = limit('maxContextTokens', body['maxContextTokens']);
    patch.maxContextTokens = tokens === undefined ? undefined : Math.round(tokens);
  }
  return patch;
}
