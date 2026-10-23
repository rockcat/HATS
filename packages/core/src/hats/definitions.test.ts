import { describe, it, expect } from 'vitest';
import { HatType } from './types.js';
import { hatDefinitions, getHatDefinition } from './definitions.js';

describe('Hat Definitions', () => {
  // The six coloured hats, plus None for an agent under no thinking
  // constraint. None is deliberately thin — it prescribes no lens — so the
  // guidance ranges below are about the six.
  const coloured = Object.values(HatType).filter((t) => t !== HatType.None);

  it('defines all 6 hats, and a seventh for no hat at all', () => {
    expect(coloured).toHaveLength(6);
    for (const type of Object.values(HatType)) {
      expect(hatDefinitions[type]).toBeDefined();
    }
  });

  it('each hat has required fields', () => {
    for (const hat of Object.values(hatDefinitions)) {
      expect(hat.type).toBeDefined();
      expect(hat.label).toBeTruthy();
      expect(hat.coreTrait).toBeTruthy();
      expect(hat.thinkingStyle).toBeTruthy();
      expect(hat.communicationTone).toBeTruthy();
      expect(hat.teamRole).toBeTruthy();
    }
  });

  it('each hat has 5-8 directives', () => {
    for (const hat of coloured.map((t) => hatDefinitions[t])) {
      expect(hat.directives.length).toBeGreaterThanOrEqual(5);
      expect(hat.directives.length).toBeLessThanOrEqual(8);
    }
  });

  it('each hat has 3-5 avoidances', () => {
    for (const hat of coloured.map((t) => hatDefinitions[t])) {
      expect(hat.avoidances.length).toBeGreaterThanOrEqual(3);
      expect(hat.avoidances.length).toBeLessThanOrEqual(5);
    }
  });

  it('getHatDefinition returns correct hat', () => {
    const hat = getHatDefinition(HatType.Black);
    expect(hat.type).toBe(HatType.Black);
    expect(hat.label).toBe('Black Hat');
  });
});
