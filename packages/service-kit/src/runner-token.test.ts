import { describe, expect, it, vi } from 'vitest';
import type { IncomingMessage } from 'http';
import { runnerGate, runnerToken, runnerTokenHeaders } from './runner-token.js';

const req = (authorization?: string) => ({ headers: authorization ? { authorization } : {} }) as IncomingMessage;

describe('the runner token', () => {
  it('lets in a request carrying it, and nothing else', () => {
    const gate = runnerGate('s3cret');
    expect(gate(req('Bearer s3cret'))).toBe(true);
    expect(gate(req('Bearer wrong'))).toBe(false);
    expect(gate(req('Bearer s3cre'))).toBe(false);
    expect(gate(req())).toBe(false);
  });

  it('lets everyone in when none is set, and says so once', () => {
    const warn = vi.fn();
    const gate = runnerGate(undefined, warn);
    expect(gate(req())).toBe(true);
    expect(gate(req())).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('is read from the environment and sent as a bearer token', () => {
    expect(runnerToken({ HATS_RUNNER_TOKEN: ' abc ' })).toBe('abc');
    expect(runnerToken({ HATS_RUNNER_TOKEN: '' })).toBeUndefined();
    expect(runnerTokenHeaders('abc')).toEqual({ Authorization: 'Bearer abc' });
    expect(runnerTokenHeaders(undefined)).toEqual({});
  });
});
