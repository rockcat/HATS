import { describe, it, expect } from 'vitest';
import { projectCopy, hasCopyOf } from './project-agents.js';
import { MockProvider } from '../providers/mock.js';
import { HatType } from '../../../packages/core/src/hats/types.js';
import type { AgentDefinition } from '../store/team-snapshot.js';

const template: AgentDefinition = {
  id: 'tpl', identity: { name: 'Poppy', visualDescription: 'x' }, hatType: [HatType.Blue],
  model: 'm', providerName: 'anthropic', scheduledActionIds: ['a1'],
  enabledMcpServers: ['imap'], maxCostPerHour: 0.5, maxContextTokens: 32000,
};

describe('copying a template into a project', () => {
  it('gives the copy its own id, pointing back at the template', () => {
    const copy = projectCopy(template, new MockProvider({ content: '' }));
    expect(copy.id).not.toBe('tpl');
    expect(copy.templateId).toBe('tpl');
    expect(copy).toMatchObject({ model: 'm', maxCostPerHour: 0.5, maxContextTokens: 32000, enabledMcpServers: ['imap'] });
  });

  it('shares nothing a project edit could change in the template', () => {
    const copy = projectCopy(template, new MockProvider({ content: '' }));
    copy.identity.name = 'Pip';
    copy.enabledMcpServers!.push('kanban');
    copy.hatType.push(HatType.Red);
    expect(template.identity.name).toBe('Poppy');
    expect(template.enabledMcpServers).toEqual(['imap']);
    expect(template.hatType).toEqual([HatType.Blue]);
  });
});

describe('whether a project already has a template\'s agent', () => {
  it('knows a copy by its templateId, and an older agent by the template\'s own id', () => {
    expect(hasCopyOf([{ id: 'x', config: { templateId: 'tpl' } }], 'tpl')).toBe(true);
    expect(hasCopyOf([{ id: 'tpl', config: {} }], 'tpl')).toBe(true);
    expect(hasCopyOf([{ id: 'x', config: { templateId: 'other' } }], 'tpl')).toBe(false);
  });
});
