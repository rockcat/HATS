import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { createDeployedAgent } from '@hats/contracts/factories';
import type { VisitPolicy } from '@hats/contracts/types';
import { ProjectStore } from '../project-store.js';
import { VisitService } from './visit-service.js';
import { MoveService } from './move-service.js';

let dir = '';
let projects: ProjectStore;
let visits: VisitService;
let moves: MoveService;

async function team(id: string, visitPolicy: VisitPolicy, names: string[]) {
  await projects.create({
    id, name: id, settings: { visits: visitPolicy },
    team: names.map((n) => createDeployedAgent({ instanceId: `id-${n.toLowerCase()}`, name: n })),
  });
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'hats-moves-'));
  projects = new ProjectStore({
    definitionsDir: path.join(dir, 'definitions'), projectsRoot: path.join(dir, 'projects'),
    activeFile: path.join(dir, 'active.json'),
  });
  await projects.load();
  visits = new VisitService(projects, path.join(dir, 'visits'));
  await visits.load();
  moves = new MoveService(projects, visits, path.join(dir, 'moves'));
  await moves.load();
  await team('ops', { visitTo: ['billing'] }, ['Ann', 'Bo']);
  await team('billing', { hostFrom: ['ops'] }, ['Cy']);
});

afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('a permanent move', () => {
  it('takes the agent from one team to the other in one go, and keeps its pack until it arrives', async () => {
    const move = await moves.move({ agent: 'id-ann', from: 'ops', to: 'billing', note: 'better fit', pack: { zip: 'x' } });
    expect(move).toMatchObject({ state: 'moving', from: 'ops', to: 'billing', note: 'better fit', agent: { name: 'Ann' } });
    expect(projects.get('ops')!.team.map((a) => a.name)).toEqual(['Bo']);
    expect(projects.get('billing')!.team.find((a) => a.name === 'Ann')).toMatchObject({ move: move.id });
    expect(await moves.readPack(move.id)).toEqual({ zip: 'x' });

    const done = await moves.done(move.id);
    expect(done.state).toBe('done');
    expect(projects.get('billing')!.team.find((a) => a.name === 'Ann')).not.toHaveProperty('move');
    expect(await readdir(path.join(dir, 'moves', 'packs'))).toEqual([]);
    expect((await moves.done(move.id)).state).toBe('done');
  });

  it('is refused where the new team does not take agents from the old one', async () => {
    await expect(moves.move({ agent: 'id-cy', from: 'billing', to: 'ops', pack: {} }))
      .rejects.toMatchObject({ status: 409, message: expect.stringMatching(/does not take agents/) });
  });

  it('waits for a visit under way', async () => {
    await projects.update('billing', { settings: { visits: { hostFrom: ['ops'], approval: 'admin' } } });
    await visits.request({ agent: 'id-ann', home: 'ops', host: 'billing', reason: { ticket: 'T', purpose: 'p', expectedResult: 'r' } });
    await expect(moves.move({ agent: 'id-ann', from: 'ops', to: 'billing', pack: {} }))
      .rejects.toMatchObject({ message: expect.stringMatching(/visit under way/) });
  });
});
