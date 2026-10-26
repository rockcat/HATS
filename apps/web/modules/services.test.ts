import { describe, it, expect } from 'vitest';
// @ts-expect-error — a browser module; browserUrl takes the page location as an argument.
import { browserUrl } from './services.js';

const page = { hostname: 'my-pc' };

describe('a service URL the browser can open', () => {
  it('swaps Docker\'s name for the host for the dashboard\'s own host', () => {
    expect(browserUrl('http://host.docker.internal:3010', page)).toBe('http://my-pc:3010/');
  });

  it('leaves any other URL alone', () => {
    expect(browserUrl('https://lib.example/agents', page)).toBe('https://lib.example/agents');
  });

  it('is nothing for something that is not a URL', () => {
    expect(browserUrl('not a url', page)).toBeNull();
  });
});
