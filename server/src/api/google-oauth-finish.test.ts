import { describe, it, expect } from 'vitest';
import { finishPage, returnUrl } from './google-oauth-finish.js';

describe('the page Google sends you back to', () => {
  it('closes itself when a window opened it', () => {
    const html = finishPage({ success: true });
    expect(html).toContain('window.opener');
    expect(html).toContain('window.close()');
  });

  it('goes back to the dashboard when there is no opener', () => {
    // Where a blocked popup leaves us: telling the user to close a window
    // they cannot close is the one thing that must not happen.
    const html = finishPage({ success: true });
    expect(html).toContain('window.location.replace');
    expect(html).not.toContain('You can close this window');
  });

  it('posts to this origin, not to anyone listening', () => {
    // The dashboard and this page are both served by the runner.
    const html = finishPage({ success: true, email: 'a@b.c' });
    expect(html).toContain('window.location.origin');
    expect(html).not.toContain("'*'");
  });

  it('tells the opener which agent the sign-in was for', () => {
    const html = finishPage({ success: true, agent: 'Poppy', email: 'poppy@example.com' });
    expect(html).toContain('"agent":"Poppy"');
    expect(html).toContain('"email":"poppy@example.com"');
  });

  it('reports a failure with its reason', () => {
    const html = finishPage({ success: false, message: 'access_denied' });
    expect(html).toContain('google-auth-error');
    expect(html).toContain('access_denied');
  });

  it('escapes what Google put in the error, which lands in the page', () => {
    const html = finishPage({ success: false, message: '<img src=x onerror=alert(1)>' });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('escapes a hostile error inside the script payload too', () => {
    // JSON.stringify is what stands between a query parameter and a script tag.
    const html = finishPage({ success: false, message: '</script><script>alert(1)' });
    expect(html).not.toMatch(/<\/script><script>alert/);
  });

  it('names the account on success, when Google told us', () => {
    expect(finishPage({ success: true, email: 'paul@example.com' }))
      .toContain('Connected as paul@example.com');
  });
});

describe('where it sends you back to', () => {
  it('marks a success', () => {
    expect(returnUrl({ success: true })).toBe('/?google=success');
  });

  it('carries the reason for a failure', () => {
    expect(returnUrl({ success: false, message: 'access_denied' }))
      .toBe('/?google=error&reason=access_denied');
  });

  it('carries the agent, so the dashboard can say whose it was', () => {
    expect(returnUrl({ success: true, agent: 'Poppy' })).toContain('agent=Poppy');
  });

  it('does not carry an email on a failure — there is none', () => {
    expect(returnUrl({ success: false, message: 'x', email: 'a@b.c' })).not.toContain('email');
  });

  it('encodes a name with a space in it', () => {
    expect(returnUrl({ success: true, agent: 'Ms Poppy' })).toContain('agent=Ms+Poppy');
  });
});
