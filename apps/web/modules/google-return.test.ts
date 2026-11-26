import { describe, it, expect } from 'vitest';
// @ts-expect-error — a browser module; the parsing half is pure.
import { parseGoogleReturn, googleReturnMessage } from './google-return.js';

describe('noticing a return from Google', () => {
  it('ignores an ordinary page load', () => {
    expect(parseGoogleReturn('')).toBeNull();
    expect(parseGoogleReturn('?project=paige')).toBeNull();
  });

  it('reads a success', () => {
    expect(parseGoogleReturn('?google=success')).toEqual({
      ok: true, agent: null, email: null, reason: null,
    });
  });

  it('reads a failure and its reason', () => {
    const outcome = parseGoogleReturn('?google=error&reason=access_denied');
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('access_denied');
  });

  it('reads which agent it was for', () => {
    expect(parseGoogleReturn('?google=success&agent=Poppy').agent).toBe('Poppy');
  });

  it('decodes a name with a space', () => {
    expect(parseGoogleReturn('?google=success&agent=Ms+Poppy').agent).toBe('Ms Poppy');
  });

  it('ignores a value that is neither success nor error', () => {
    // Somebody hand-editing the URL should not get a fabricated outcome.
    expect(parseGoogleReturn('?google=maybe')).toBeNull();
  });
});

describe('what it says about the return', () => {
  it('names the account when there is one', () => {
    expect(googleReturnMessage({ ok: true, agent: null, email: 'p@e.com', reason: null }))
      .toBe('Google account connected as p@e.com.');
  });

  it('says whose account it was, on the per-agent flow', () => {
    expect(googleReturnMessage({ ok: true, agent: 'Poppy', email: null, reason: null }))
      .toContain("Poppy's Google account");
  });

  it('gives the reason it failed', () => {
    expect(googleReturnMessage({ ok: false, agent: null, email: null, reason: 'access_denied' }))
      .toContain('access_denied');
  });

  it('does not claim to know a reason it was not given', () => {
    expect(googleReturnMessage({ ok: false, agent: null, email: null, reason: null }))
      .toContain('no reason given');
  });

  it('says nothing about a load that was not a return', () => {
    expect(googleReturnMessage(null)).toBe('');
  });
});
