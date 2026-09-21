import { describe, it, expect } from 'vitest';
// @ts-expect-error — a browser module, deliberately free of imports so it can be tested here.
import { filterRoster, mergeRoster, subtitleFor } from './roster-model.js';

const template = (name: string, extra: Record<string, unknown> = {}) => ({
  id: `tpl-${name}`, name, hats: ['blue'],
  identity: { specialisation: 'Analyst', avatar: 'casey.glb', voice: 'en_GB-alba-medium' },
  ...extra,
});

const liveAgent = (name: string, extra: Record<string, unknown> = {}) => ({
  id: `inst-${name}`, name, hats: ['green'], state: 'working', activity: 'Drafting the plan',
  identity: { specialisation: 'Analyst', avatar: 'max.glb', voice: 'en_GB-semaine-medium' },
  ...extra,
});

describe('mergeRoster', () => {
  it('lists every library template, not just the deployed team', () => {
    const rows = mergeRoster([liveAgent('Poppy')], [template('Poppy'), template('Amara'), template('Blake')]);
    expect(rows.map((r) => r.name)).toEqual(['Poppy', 'Amara', 'Blake']);
  });

  it('keeps two templates that share a name as two agents', () => {
    // The library really does hold two agents called Dave; collapsing them
    // would silently lose one.
    const rows = mergeRoster([], [
      { ...template('Dave'), id: 'tpl-dave-1' },
      { ...template('Dave'), id: 'tpl-dave-2' },
    ]);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });

  it('puts the deployed agents first', () => {
    const rows = mergeRoster([liveAgent('Zara')], [template('Amara'), template('Zara')]);
    expect(rows.map((r) => r.name)).toEqual(['Zara', 'Amara']);
  });

  it('prefers the running agent over its template, which may have drifted', () => {
    const [row] = mergeRoster([liveAgent('Poppy')], [template('Poppy')]);
    expect(row.identity.avatar).toBe('max.glb');
    expect(row.live).not.toBeNull();
    // The template is kept, so the row still knows where the agent came from.
    expect(row.template?.id).toBe('tpl-Poppy');
  });

  it('matches a deployed agent to its template by id, not by name', () => {
    const rows = mergeRoster(
      [liveAgent('Dave', { templateId: 'tpl-dave-2' })],
      [{ ...template('Dave'), id: 'tpl-dave-1' }, { ...template('Dave'), id: 'tpl-dave-2' }],
    );
    expect(rows.find((r) => r.live)?.template.id).toBe('tpl-dave-2');
    expect(rows.filter((r) => !r.live).map((r) => r.template.id)).toEqual(['tpl-dave-1']);
  });

  it('falls back to the name when the runner reports no templateId', () => {
    const [row] = mergeRoster([liveAgent('POPPY')], [template('poppy')]);
    expect(row.live).not.toBeNull();
    expect(row.template?.id).toBe('tpl-poppy');
  });

  it('never lets two instances claim the same template row', () => {
    const rows = mergeRoster([liveAgent('Dave'), { ...liveAgent('Dave'), id: 'inst-Dave-2' }], [template('Dave')]);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.live)).toBe(true);
  });

  it('keeps a deployed agent that is not in the library', () => {
    const rows = mergeRoster([liveAgent('Ghost')], []);
    expect(rows.map((r) => r.name)).toEqual(['Ghost']);
  });

  it('gives a row a key that survives the agent being deployed', () => {
    const [dormant] = mergeRoster([], [template('Poppy')]);
    const [running] = mergeRoster([liveAgent('Poppy')], [template('Poppy')]);
    expect(running.key).toBe(dormant.key);
  });

  it('works with either source absent — neither upstream is required', () => {
    expect(mergeRoster([], [template('Amara')]).map((r) => r.name)).toEqual(['Amara']);
    expect(mergeRoster([liveAgent('Amara')], []).map((r) => r.name)).toEqual(['Amara']);
    expect(mergeRoster([], [])).toEqual([]);
  });
});

describe('filterRoster', () => {
  const rows = mergeRoster(
    [liveAgent('Poppy')],
    [template('Poppy'), template('Amara', { identity: { specialisation: 'Finance' } })],
  );

  it('returns everything by default', () => {
    expect(filterRoster(rows)).toHaveLength(2);
  });

  it('searches name, specialisation and hats', () => {
    expect(filterRoster(rows, { search: 'finance' }).map((r) => r.name)).toEqual(['Amara']);
    expect(filterRoster(rows, { search: 'popp' }).map((r) => r.name)).toEqual(['Poppy']);
    expect(filterRoster(rows, { search: 'green' }).map((r) => r.name)).toEqual(['Poppy']);
  });

  it('narrows to the deployed team on request', () => {
    expect(filterRoster(rows, { liveOnly: true }).map((r) => r.name)).toEqual(['Poppy']);
  });
});

describe('subtitleFor', () => {
  it('shows what a running agent is doing', () => {
    const [row] = mergeRoster([liveAgent('Poppy')], []);
    expect(subtitleFor(row)).toBe('Drafting the plan');
  });

  it('says plainly that a library agent is not deployed', () => {
    const [row] = mergeRoster([], [template('Amara', { identity: {} })]);
    expect(subtitleFor(row)).toBe('in the library, not deployed');
  });
});
