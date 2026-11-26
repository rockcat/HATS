import { describe, it, expect } from 'vitest';
// @ts-expect-error — a browser module; these functions use nothing of the browser.
import { themeFrom, otherTheme } from './theme.js';

describe('the dashboard theme', () => {
  it('is dark unless light was chosen', () => {
    expect(themeFrom(null)).toBe('dark');
    expect(themeFrom('sepia')).toBe('dark');
    expect(themeFrom('light')).toBe('light');
    expect(themeFrom('dark')).toBe('dark');
  });

  it('switches between the two', () => {
    expect(otherTheme('dark')).toBe('light');
    expect(otherTheme('light')).toBe('dark');
  });
});
