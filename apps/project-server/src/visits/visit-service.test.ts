import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { createDeployedAgent } from '@hats/contracts/factories';
import type { ProjectChange, VisitPolicy } from '@hats/contracts/types';
import { ProjectStore } from '../project-store.js';
import { VisitService } from './visit-service.js';

let dir = '';
let projects: ProjectStore;
let visits: VisitService;
let changes: ProjectChange[];

const reason = { ticket: 'TKT-1', purpose: 'Read the invoices', expectedResult: 'Totals per month' };

async function team(id: string, visitPolicy: VisitPolicy, names: string[] = []) {
  await projects.create({
    id, name: id, settings: { visits: visitPolicy },
    team: names.map((n) => createDeployedAgent({ instanceId: `id-${n.toLowerCase()}`, name: n })),
  });
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'hats-visits-'));
  projects = new ProjectStore({
    definitionsDir: path.join(dir, 'definitions'), projectsRoot: path.join(dir, 'projects'),
    activeFile: path.join(dir, 'active.json'),
  });
  await projects.load();
  visits = new VisitService(projects, path.join(dir, 'visits'), () => new Date('2026-11-23T10:00:00Z'));
  await visits.load();
  await team('ops', { visitTo: ['billing'], maxHours: 3 }, ['Ann', 'Bo']);
  await team('billing', { hostFrom: ['ops'], approval: 'admin', memoryHome: 'none' }, ['Cy']);
  changes = [];
  projects.onChange((c) => changes.push(c));
});

afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const ask = () => visits.request({ agent: 'id-ann', home: 'ops', host: 'billing', reason });

describe('a visit', () => {
  it('waits for the host when it asks for approval, carrying its rules', async () => {
    const visit = await ask();
    expect(visit).toMatchObject({ state: 'requested', approval: 'admin', memoryHome: 'none', agent: { name: 'Ann' } });
    expect(changes).toEqual([{ type: 'visit_changed', id: visit.id, home: 'ops', host: 'billing', state: 'requested' }]);
  });

  it('is approved at once by a host that does not ask', async () => {
    await projects.update('billing', { settings: { visits: { hostFrom: ['ops'], approval: 'auto' } } });
    expect((await ask()).state).toBe('approved');
  });

  it('is refused when the teams have not agreed, and kept from asking twice', async () => {
    await projects.update('billing', { settings: { visits: { hostFrom: [] } } });
    await expect(ask()).rejects.toMatchObject({ status: 409 });
    await projects.update('billing', { settings: { visits: { hostFrom: ['ops'] } } });
    await ask();
    await expect(ask()).rejects.toMatchObject({ message: expect.stringMatching(/already asked/) });
  });

  it('leaves home in one change to both teams, and gets a deadline', async () => {
    const asked = await ask();
    await visits.approve(asked.id, 'fine by me');
    const left = await visits.leave(asked.id, { memory: 'graph' });

    expect(left).toMatchObject({ state: 'visiting', endsBy: '2026-11-23T13:00:00.000Z' });
    expect(projects.get('ops')!.team.find((a) => a.name === 'Ann')!.away).toEqual({ visit: asked.id, host: 'billing' });
    expect(projects.get('billing')!.team.find((a) => a.name === 'Ann')).toMatchObject({ home: 'ops', visit: asked.id });
    expect(await visits.readPack(asked.id, 'out')).toEqual({ memory: 'graph' });
    const changed = changes.filter((c) => c.type === 'project_changed').map((c) => c.id);
    expect(changed).toEqual(['ops', 'billing']);
  });

  it('cannot leave before it is approved', async () => {
    const asked = await ask();
    await expect(visits.leave(asked.id, {})).rejects.toMatchObject({ status: 409 });
  });

  it('comes home with its result, and its packs go once home has it', async () => {
    const asked = await ask();
    await visits.approve(asked.id);
    await visits.leave(asked.id, {});
    const back = await visits.return(asked.id, { outcome: 'done', summary: '£12k a month' }, { by: 'finished' }, { learned: [] });

    expect(back).toMatchObject({ state: 'returning', result: { outcome: 'done' }, ended: { by: 'finished' } });
    expect(projects.get('billing')!.team.map((a) => a.name)).toEqual(['Cy']);
    expect(projects.get('ops')!.team.find((a) => a.name === 'Ann')).not.toHaveProperty('away');
    expect(await visits.readPack(asked.id, 'back')).toEqual({ learned: [] });

    expect((await visits.home(asked.id)).state).toBe('home');
    expect(await readdir(path.join(dir, 'visits', 'packs'))).toEqual([]);
  });

  it('can be cancelled before leaving, but not after', async () => {
    const asked = await ask();
    expect((await visits.cancel(asked.id, 'not needed')).state).toBe('cancelled');
    const again = await ask();
    await visits.approve(again.id);
    await visits.leave(again.id, {});
    await expect(visits.cancel(again.id)).rejects.toMatchObject({ status: 409 });
  });

  it('lists the visits involving a project, open ones only when asked', async () => {
    const asked = await ask();
    await visits.refuse(asked.id, 'busy');
    expect(visits.list('billing').map((v) => v.state)).toEqual(['refused']);
    expect(visits.list('billing', true)).toEqual([]);
    expect(visits.list('research')).toEqual([]);
  });
});

describe('recalling a visitor', () => {
  it('records that home wants it back and tells both teams, while it is visiting only', async () => {
    const asked = await ask();
    await expect(visits.recall(asked.id, 'recalled')).rejects.toMatchObject({ status: 409 });
    await visits.approve(asked.id);
    await visits.leave(asked.id, {});
    changes = [];
    const recalled = await visits.recall(asked.id, 'reason-gone', 'TKT-1 was closed');
    expect(recalled).toMatchObject({ state: 'visiting', recall: { by: 'reason-gone', note: 'TKT-1 was closed' } });
    expect(changes).toEqual([{ type: 'visit_changed', id: asked.id, home: 'ops', host: 'billing', state: 'visiting' }]);
  });
});
