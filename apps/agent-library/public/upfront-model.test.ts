import { describe, it, expect } from 'vitest';
// @ts-expect-error — a browser module, deliberately free of imports so it can be tested here.
import { combineSelection, isSelected, splitForPreview, toolSources } from './upfront-model.js';

const catalogue = {
  personal: [
    { id: 'email-imap', name: 'Email', knownTools: [{ name: 'get_email', description: 'Get one.' }] },
    { id: 'google-calendar-personal', name: 'Calendar', knownTools: [] },
  ],
  shared: [
    { id: 'kanban', name: 'Kanban' },
    { id: 'brave-search', name: 'Brave Search' },
  ],
};

describe('toolSources', () => {
  it('offers only the personal servers this agent has actually set up', () => {
    // Offering a mailbox the agent has no credentials for would be a trap.
    const sources = toolSources(catalogue, ['email-imap'], undefined);
    expect(sources.filter((s: { scope: string }) => s.scope === 'personal').map((s: { id: string }) => s.id))
      .toEqual(['email-imap']);
  });

  it('puts the agent\'s own servers first', () => {
    const sources = toolSources(catalogue, ['email-imap'], undefined);
    expect(sources.map((s: { id: string }) => s.id)).toEqual(['email-imap', 'kanban', 'brave-search']);
  });

  it('offers every team server when there is no allow-list', () => {
    const sources = toolSources(catalogue, [], undefined);
    expect(sources.map((s: { id: string }) => s.id)).toEqual(['kanban', 'brave-search']);
  });

  it('respects an allow-list, since the agent cannot reach the rest', () => {
    const sources = toolSources(catalogue, [], ['kanban']);
    expect(sources.map((s: { id: string }) => s.id)).toEqual(['kanban']);
  });

  it('marks where each server came from', () => {
    const sources = toolSources(catalogue, ['email-imap'], ['kanban']);
    expect(sources.map((s: { scope: string }) => s.scope)).toEqual(['personal', 'team']);
  });

  it('copes with an empty catalogue', () => {
    expect(toolSources(undefined, [], undefined)).toEqual([]);
    expect(toolSources({ personal: [], shared: [] }, ['email-imap'], undefined)).toEqual([]);
  });
});

describe('isSelected', () => {
  it('ticks a tool named directly', () => {
    expect(isSelected(['email-imap:get_email'], 'email-imap', 'get_email')).toBe(true);
    expect(isSelected(['email-imap:get_email'], 'email-imap', 'send_email')).toBe(false);
  });

  it('ticks every tool of a server chosen whole', () => {
    expect(isSelected(['email-imap'], 'email-imap', 'anything_at_all')).toBe(true);
  });

  it('ignores case, as the runner does', () => {
    expect(isSelected(['Email-IMAP:Get_Email'.toLowerCase()], 'email-imap', 'get_email')).toBe(true);
  });
});

describe('combineSelection', () => {
  it('keeps servers and single tools together', () => {
    expect(combineSelection(['kanban'], ['email-imap:get_email']))
      .toEqual(['kanban', 'email-imap:get_email']);
  });

  it('drops a tool already covered by its own server', () => {
    // Storing both would drift as the server gains and loses tools.
    expect(combineSelection(['email-imap'], ['email-imap:get_email', 'kanban:create_ticket']))
      .toEqual(['email-imap', 'kanban:create_ticket']);
  });

  it('returns an empty list when nothing is ticked, which means "send nothing"', () => {
    expect(combineSelection([], [])).toEqual([]);
    expect(combineSelection()).toEqual([]);
  });
});

describe('splitForPreview', () => {
  const sources = [
    {
      id: 'email-imap', scope: 'personal',
      knownTools: [
        { name: 'get_email', description: 'Get one.' },
        { name: 'create_label', description: 'Label it.' },
      ],
    },
    {
      id: 'kanban', scope: 'team',
      knownTools: [{ name: 'create_ticket', description: 'Raise one.' }],
    },
  ];

  const names = (list: Array<{ name: string }>) => list.map((t) => t.name);

  it('defaults to the agent\'s own servers upfront, team servers by search', () => {
    const { upfront, searchable } = splitForPreview(sources, undefined);
    expect(names(upfront)).toEqual(['get_email', 'create_label']);
    expect(names(searchable)).toEqual(['create_ticket']);
  });

  it('sends nothing upfront for an empty list', () => {
    const { upfront, searchable } = splitForPreview(sources, []);
    expect(upfront).toEqual([]);
    expect(searchable).toHaveLength(3);
  });

  it('takes a whole server', () => {
    expect(names(splitForPreview(sources, ['email-imap']).upfront))
      .toEqual(['get_email', 'create_label']);
  });

  it('takes a single tool, which is the point for a large server', () => {
    const { upfront, searchable } = splitForPreview(sources, ['email-imap:get_email']);
    expect(names(upfront)).toEqual(['get_email']);
    expect(names(searchable)).toContain('create_label');
  });

  it('promotes a team tool when asked', () => {
    expect(names(splitForPreview(sources, ['kanban:create_ticket']).upfront)).toEqual(['create_ticket']);
  });

  it('names a selector that matches nothing, which is otherwise silent', () => {
    // The tool simply never appears and nobody is told why.
    const { unknown } = splitForPreview(sources, ['email-imap:get_emails', 'kanban']);
    expect(unknown).toEqual(['email-imap:get_emails']);
  });

  it('accounts for every tool, whichever way it is split', () => {
    for (const selectors of [undefined, [], ['kanban'], ['email-imap:get_email']]) {
      const { upfront, searchable } = splitForPreview(sources, selectors);
      expect(upfront.length + searchable.length, String(selectors)).toBe(3);
    }
  });

  it('copes with a server that has never run', () => {
    const unseen = [{ id: 'brave-search', scope: 'team' }];
    expect(splitForPreview(unseen, undefined)).toEqual({ upfront: [], searchable: [], unknown: [] });
  });
});
