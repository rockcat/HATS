import { describe, expect, it, vi } from 'vitest';
import { switchRefusal } from './project-holder.js';

type Status = 'running' | 'starting' | 'stopped' | 'unreachable';

/** A fetch answering with the manager's list. */
function manager(projects: { id: string; runner: { port: number; status: Status } | null }[], status = 200) {
  return vi.fn(async () => new Response(JSON.stringify({ projects, canLaunch: false }), { status }));
}

const base = { managerUrl: 'http://runner-manager:3080', ownPort: 3001, credential: 'tok' };

describe('switchRefusal', () => {
  it('allows a project with no runner', async () => {
    const fetchImpl = manager([{ id: 'paige', runner: null }]);
    expect(await switchRefusal('paige', { ...base, fetchImpl })).toBeNull();
  });

  it('allows a project whose runner is stopped', async () => {
    const fetchImpl = manager([{ id: 'paige', runner: { port: 3101, status: 'stopped' } }]);
    expect(await switchRefusal('paige', { ...base, fetchImpl })).toBeNull();
  });

  it('allows a project the manager does not list', async () => {
    const fetchImpl = manager([]);
    expect(await switchRefusal('paige', { ...base, fetchImpl })).toBeNull();
  });

  it('does not count this runner against itself', async () => {
    const fetchImpl = manager([{ id: 'evan', runner: { port: 3001, status: 'running' } }]);
    expect(await switchRefusal('evan', { ...base, fetchImpl })).toBeNull();
  });

  it.each(['running', 'starting', 'unreachable'] as const)('refuses a project another runner holds while %s', async (status) => {
    const fetchImpl = manager([{ id: 'Paige', runner: { port: 3101, status } }]);
    const refusal = await switchRefusal('paige', { ...base, fetchImpl });
    expect(refusal).toContain('port 3101');
  });

  it('says when the other runner is not answering', async () => {
    const fetchImpl = manager([{ id: 'paige', runner: { port: 3101, status: 'unreachable' } }]);
    expect(await switchRefusal('paige', { ...base, fetchImpl })).toContain('not answering');
  });

  it('passes the caller\'s sign-in to the manager', async () => {
    const fetchImpl = manager([]);
    await switchRefusal('paige', { ...base, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://runner-manager:3080/api/v1/runners',
      expect.objectContaining({ headers: { Authorization: 'Bearer tok' } }),
    );
  });

  it('refuses when the manager says no', async () => {
    const fetchImpl = manager([], 401);
    expect(await switchRefusal('paige', { ...base, fetchImpl })).toContain('Could not check');
  });

  it('refuses when the manager cannot be reached', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('fetch failed'); });
    expect(await switchRefusal('paige', { ...base, fetchImpl })).toContain('Could not check');
  });
});
