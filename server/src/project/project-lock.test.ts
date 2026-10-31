import { describe, it, expect } from 'vitest';
import { projectLocked } from './project-lock.js';

describe('keeping a runner on one project', () => {
  it('is off unless asked for', () => {
    expect(projectLocked({})).toBe(false);
    for (const off of ['', '0', 'false', 'No', 'off']) expect(projectLocked({ HATS_PROJECT_LOCKED: off })).toBe(false);
  });

  it('is on for any other value', () => {
    for (const on of ['1', 'true', 'yes', 'ON']) expect(projectLocked({ HATS_PROJECT_LOCKED: on })).toBe(true);
  });
});
