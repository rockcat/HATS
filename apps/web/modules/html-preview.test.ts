import { describe, it, expect } from 'vitest';
// @ts-expect-error — a browser module, deliberately free of imports so it can be tested here.
import { htmlForPreview, SANDBOX } from './html-preview.js';

describe('previewing an HTML file safely', () => {
  const page = '<!doctype html><html><head><script src="https://evil.example/x.js"></script></head><body>Hi</body></html>';

  it('never gives the page an origin, so it cannot reach the dashboard', () => {
    expect(SANDBOX.still).not.toMatch(/allow-same-origin/);
    expect(SANDBOX.scripts).not.toMatch(/allow-same-origin/);
    expect(SANDBOX.still).not.toMatch(/allow-scripts/);
  });

  it('by default, puts a policy first that blocks scripts and every network load', () => {
    const doc = htmlForPreview(page);
    expect(doc.startsWith('<meta http-equiv="Content-Security-Policy"')).toBe(true);
    expect(doc).toContain("default-src 'none'");
    expect(doc).not.toMatch(/script-src/);
    expect(doc.endsWith(page)).toBe(true);
  });

  it('leaves the page as it is when scripts are allowed to run', () => {
    expect(htmlForPreview(page, { scripts: true })).toBe(page);
  });
});
