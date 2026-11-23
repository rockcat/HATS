import { describe, expect, it } from 'vitest';
import { createDeployedAgent } from '../../../packages/contracts/src/factories.js';
import type { DeployedAgent } from '../../../packages/contracts/src/types.js';
import { describeChanges } from './team-news.js';

const none = { leaving: [], arriving: [], returning: [], departing: [], movingIn: [] };

const member = (name: string, extra: Partial<DeployedAgent> = {}): DeployedAgent =>
  createDeployedAgent({ instanceId: `id-${name.toLowerCase()}`, name, hats: ['white'], ...extra });

describe('describeChanges', () => {
  it('says who joined, with what they do, and who left', () => {
    const news = describeChanges({ ...none,
      added: [member('Bo', { hats: ['white', 'red'], identity: { specialisation: 'testing' } }), member('Di')],
      removed: ['Cy'],
      changed: [],
    });
    expect(news).toEqual([
      'Bo joined the team (testing, wearing the white and red hats).',
      'Di joined the team (wearing the white hat).',
      'Cy left the team.',
    ]);
  });

  it('describes what teammates work with: name, specialisation, hats and model', () => {
    const from = member('Ann', { identity: { specialisation: 'design' } });
    const to = member('Annie', {
      instanceId: 'id-ann',
      hats: ['black'],
      identity: { specialisation: 'research' },
      model: { provider: 'openai', model: 'gpt-x' },
    });
    expect(describeChanges({ ...none, added: [], removed: [], changed: [{ from, to }] })).toEqual([
      'Ann is now called Annie.',
      'Annie now specialises in research.',
      'Annie now wears the black hat.',
      'Annie now runs on openai gpt-x.',
    ]);
  });

  it('leaves out changes no teammate needs, such as an avatar or cost limits', () => {
    const from = member('Ann');
    const to = member('Ann', { identity: { avatar: 'max.glb' }, limits: { maxCostPerHour: 3 } });
    expect(describeChanges({ ...none, added: [], removed: [], changed: [{ from, to }] })).toEqual([]);
  });

  it('announces a new goal', () => {
    expect(describeChanges({ ...none, added: [], removed: [], changed: [] }, 'Ship the beta'))
      .toEqual(['The project goal is now: Ship the beta']);
  });
});
