import { describe, it, expect } from 'vitest';
// @ts-expect-error — a browser module; these functions use nothing of the browser.
import { fileUrl, dashboardLinkFor, fileFromSearch, baseName } from './file-links.js';

const loc = { origin: 'http://localhost:3001', pathname: '/' };

describe('links to a project file', () => {
  it('serves it from the project file API', () => {
    expect(fileUrl('outputs/my plan.md')).toBe('/api/project/file?path=outputs%2Fmy%20plan.md');
  });

  it('opens the dashboard on it, and reads that back', () => {
    const link = dashboardLinkFor('outputs/my plan.md', loc);
    expect(link).toBe('http://localhost:3001/?file=outputs%2Fmy%20plan.md');
    expect(fileFromSearch(new URL(link).search)).toBe('outputs/my plan.md');
  });

  it('opens nothing for a link without a file, or one leaving the project', () => {
    expect(fileFromSearch('')).toBeNull();
    expect(fileFromSearch('?file=..%2Fsecrets')).toBeNull();
  });

  it('names a file by the end of its path', () => {
    expect(baseName('outputs/launch/press.md')).toBe('press.md');
  });
});
