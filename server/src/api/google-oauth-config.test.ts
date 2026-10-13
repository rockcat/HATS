import { describe, it, expect, afterEach } from 'vitest';
import { isGoogleOAuthConfigured } from './google-oauth-router.js';

const ID = 'GOOGLE_CLIENT_ID';
const SECRET = 'GOOGLE_CLIENT_SECRET';
const original = { id: process.env[ID], secret: process.env[SECRET] };

const set = (id?: string, secret?: string) => {
  if (id === undefined) delete process.env[ID]; else process.env[ID] = id;
  if (secret === undefined) delete process.env[SECRET]; else process.env[SECRET] = secret;
};

afterEach(() => set(original.id, original.secret));

describe('whether this runner can start a Google sign-in', () => {
  it('can, with both halves of the credential', () => {
    set('client-id', 'client-secret');
    expect(isGoogleOAuthConfigured()).toBe(true);
  });

  it('cannot, with neither', () => {
    // The state this repo ships in: the Connect button would open a popup
    // reading "GOOGLE_CLIENT_ID is not configured", which looks like a broken
    // feature rather than an unfinished setup.
    set(undefined, undefined);
    expect(isGoogleOAuthConfigured()).toBe(false);
  });

  it('cannot with only the id', () => {
    // The start route would redirect to Google and the callback would then
    // fail — the worst place to discover it.
    set('client-id', undefined);
    expect(isGoogleOAuthConfigured()).toBe(false);
  });

  it('cannot with only the secret', () => {
    set(undefined, 'client-secret');
    expect(isGoogleOAuthConfigured()).toBe(false);
  });

  it('treats an empty value as absent', () => {
    // A key left blank in .env is the commonest way to half-configure this.
    set('', '');
    expect(isGoogleOAuthConfigured()).toBe(false);
  });

  it('treats a blank id with a real secret as absent', () => {
    set('', 'client-secret');
    expect(isGoogleOAuthConfigured()).toBe(false);
  });
});
