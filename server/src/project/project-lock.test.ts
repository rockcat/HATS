import { describe, it, expect } from 'vitest';
import { projectLocked, switchRefusal, PROJECT_LOCKED_MESSAGE, RUNNER_MANAGED_MESSAGE } from './project-lock.js';

describe('keeping a runner on one project', () => {
  it('is off unless asked for', () => {
    expect(projectLocked({})).toBe(false);
    for (const off of ['', '0', 'false', 'No', 'off']) expect(projectLocked({ HATS_PROJECT_LOCKED: off })).toBe(false);
  });

  it('is on for any other value', () => {
    for (const on of ['1', 'true', 'yes', 'ON']) expect(projectLocked({ HATS_PROJECT_LOCKED: on })).toBe(true);
  });
});

describe('switchRefusal', () => {
  it('lets a standalone runner switch', () => {
    expect(switchRefusal(false, {})).toBeNull();
  });

  it('refuses on a runner with a runner manager: another project means another runner', () => {
    expect(switchRefusal(true, {})).toBe(RUNNER_MANAGED_MESSAGE);
  });

  it('refuses on a locked runner, with or without a runner manager', () => {
    expect(switchRefusal(false, { HATS_PROJECT_LOCKED: '1' })).toBe(PROJECT_LOCKED_MESSAGE);
    expect(switchRefusal(true, { HATS_PROJECT_LOCKED: '1' })).toBe(PROJECT_LOCKED_MESSAGE);
  });
});
