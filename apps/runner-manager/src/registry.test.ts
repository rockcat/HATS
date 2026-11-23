import { describe, it, expect } from 'vitest';
import { Registry, STALE_AFTER_MS, freePort, mergeRunners } from './registry.js';

describe('the runners the manager knows', () => {
  it('lists a runner that reported in as running', () => {
    let now = 1_000_000;
    const registry = new Registry(() => now);
    registry.heartbeat({ project: 'paige', port: 3002 });
    expect(registry.list([])).toMatchObject([{ project: 'paige', port: 3002, status: 'running', managed: false }]);

    now += STALE_AFTER_MS + 1;
    expect(registry.list([])[0]?.status).toBe('unreachable');
  });

  it('shows its own container as starting until the runner in it reports in', () => {
    const container = { id: 'c1', project: 'rhoda', port: 3101, running: true };
    expect(mergeRunners([], [container], 0)).toMatchObject([{ project: 'rhoda', status: 'starting', managed: true }]);
    expect(mergeRunners([{ project: 'Rhoda', port: 3101, at: 0 }], [container], 1)[0])
      .toMatchObject({ project: 'Rhoda', status: 'running', managed: true });
  });

  it('shows a stopped container as stopped, whatever its runner said last', () => {
    const merged = mergeRunners([{ project: 'evan', port: 3101, at: 0 }],
      [{ id: 'c1', project: 'evan', port: 3101, running: false }], 1);
    expect(merged).toMatchObject([{ status: 'stopped', managed: true }]);
  });

  it('keeps one entry per project, in order, ignoring case', () => {
    const merged = mergeRunners(
      [{ project: 'zed', port: 3001, at: 0 }, { project: 'Amy', port: 3002, at: 0 }],
      [{ id: 'c', project: 'amy', port: 3002, running: true }], 1);
    expect(merged.map((r) => r.project)).toEqual(['Amy', 'zed']);
  });
});

describe('choosing a port for a new runner', () => {
  it('takes the lowest free one in the range', () => {
    expect(freePort([3101, 3102], 3101, 3199)).toBe(3103);
    expect(freePort([], 3101, 3199)).toBe(3101);
  });
  it('says so when the range is full', () => {
    expect(freePort([3101, 3102], 3101, 3102)).toBeNull();
  });
});

describe('a runner stopping and starting again', () => {
  it('shows a runner that said goodbye as stopped at once, and running when it reports in again', () => {
    const registry = new Registry();
    registry.heartbeat({ project: 'evan', port: 3001, container: 'abc' });
    registry.goodbye('Evan');
    expect(registry.list([])).toMatchObject([{ project: 'evan', status: 'stopped', container: 'abc' }]);

    registry.starting('evan');
    expect(registry.list([])[0]?.status).toBe('starting');

    registry.heartbeat({ project: 'evan', port: 3001, container: 'abc' });
    expect(registry.list([])[0]?.status).toBe('running');
  });

  it('shows its own container as stopped once its runner says goodbye, while Docker still has it running', () => {
    const registry = new Registry();
    registry.heartbeat({ project: 'paige', port: 3101 });
    registry.goodbye('paige');
    expect(registry.list([{ id: 'c1', project: 'paige', port: 3101, running: true }]))
      .toMatchObject([{ status: 'stopped', managed: true, container: 'c1' }]);
  });

  it('ignores a goodbye from a runner it never heard from', () => {
    const registry = new Registry();
    registry.goodbye('nobody');
    expect(registry.list([])).toEqual([]);
  });
});
