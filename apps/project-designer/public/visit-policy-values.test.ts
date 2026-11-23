// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { validateProject } from '@hats/contracts/validate';
import { createProject } from '@hats/contracts/factories';
// @ts-expect-error - plain JS module, shipped to the browser as-is
import { mergeVisitPolicy } from './visit-policy-values.js';

const form = (over: Record<string, unknown> = {}) => ({
  summary: '', tags: '', visitTo: [], hostFrom: [], approval: 'admin', memoryHome: 'summary', maxHours: '', ...over,
});

describe('mergeVisitPolicy', () => {
  it('keeps the settings the form does not show', () => {
    const next = mergeVisitPolicy(form({ visitTo: ['billing'] }), { speechEnabled: false, defaultMeetingType: 'retro' });
    expect(next).toMatchObject({ speechEnabled: false, defaultMeetingType: 'retro', visits: { visitTo: ['billing'] } });
  });

  it('tidies tags, and drops an empty summary or tag list', () => {
    expect(mergeVisitPolicy(form({ tags: ' billing, stripe,, billing ' })).tags).toEqual(['billing', 'stripe']);
    const cleared = mergeVisitPolicy(form(), { summary: 'old', tags: ['x'] });
    expect(cleared).not.toHaveProperty('summary');
    expect(cleared).not.toHaveProperty('tags');
  });

  it('takes "any team" alone, ignoring the teams ticked beside it', () => {
    expect(mergeVisitPolicy(form({ hostFrom: ['*', 'ops'] })).visits.hostFrom).toEqual(['*']);
  });

  it('sets a time limit only when one is given', () => {
    expect(mergeVisitPolicy(form({ maxHours: '4' })).visits.maxHours).toBe(4);
    expect(mergeVisitPolicy(form()).visits).not.toHaveProperty('maxHours');
  });

  it('produces settings the Project Server accepts', () => {
    const settings = mergeVisitPolicy(form({
      summary: 'Ops work.', tags: 'ops', visitTo: ['billing'], hostFrom: ['*'], approval: 'auto', maxHours: '2.5',
    }), { speechEnabled: true });
    expect(validateProject({ ...createProject({ id: 'ops', name: 'Ops' }), settings }).valid).toBe(true);
  });
});
