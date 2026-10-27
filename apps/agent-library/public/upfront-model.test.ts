import { describe, it, expect } from 'vitest';
// @ts-expect-error — a browser module, deliberately free of imports so it can be tested here.
import { combineSelection, isSelected, splitForPreview, toolSources, toolTokens } from './upfront-model.js';

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

  const names = (list: Array<{ bare: string }>) => list.map((t) => t.bare);

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
    expect(splitForPreview(unseen, undefined)).toEqual({ always: [], upfront: [], searchable: [], unknown: [] });
  });
});

describe('splitForPreview agrees with the runner', () => {
  const sources = [
    {
      id: 'email-imap', scope: 'personal',
      knownTools: [{ name: 'get_email', description: 'Read one.' }, { name: 'list_emails', description: 'List them.' }],
    },
    { id: 'kanban', scope: 'team', knownTools: [{ name: 'create_ticket', description: 'Raise one.' }] },
  ];
  const upfrontNames = (selectors?: string[]) =>
    splitForPreview(sources, selectors).upfront.map((t: { bare: string }) => t.bare);

  it('accepts a whole server', () => {
    expect(upfrontNames(['email-imap'])).toEqual(['get_email', 'list_emails']);
  });

  it('accepts server:tool', () => {
    expect(upfrontNames(['email-imap:get_email'])).toEqual(['get_email']);
  });

  it('accepts the namespaced name search results print', () => {
    // Somebody copying a name out of search_tools output writes this form, and
    // the runner honours it — so the preview must not call it unknown.
    expect(upfrontNames(['mcp__email-imap__get_email'])).toEqual(['get_email']);
    expect(splitForPreview(sources, ['mcp__email-imap__get_email']).unknown).toEqual([]);
  });

  it('accepts a bare tool name', () => {
    expect(upfrontNames(['create_ticket'])).toEqual(['create_ticket']);
    expect(splitForPreview(sources, ['create_ticket']).unknown).toEqual([]);
  });

  it('still names a selector that matches nothing', () => {
    expect(splitForPreview(sources, ['no-such-server']).unknown).toEqual(['no-such-server']);
  });

  it('ignores blank selectors rather than reporting them unknown', () => {
    expect(splitForPreview(sources, ['  ', 'email-imap']).unknown).toEqual([]);
  });

  it('an empty list means nothing upfront, not everything', () => {
    expect(upfrontNames([])).toEqual([]);
    expect(splitForPreview(sources, []).searchable).toHaveLength(3);
  });

  it('an absent list means the agent keeps its own servers', () => {
    expect(upfrontNames(undefined)).toEqual(['get_email', 'list_emails']);
  });
});

describe("splitForPreview with the runner's own tools", () => {
  const sources = [
    { id: 'email-imap', scope: 'personal', knownTools: [{ name: 'get_email', description: 'Read one.' }] },
    { id: 'brave-search', scope: 'team', knownTools: [{ name: 'web_search', description: 'Search.' }] },
  ];
  const tool = (name: string, source: string) => ({ name, description: name, source, parameters: { type: 'object', properties: {} } });
  const builtin = {
    core: [tool('send_message', 'runner'), tool('search_tools', 'runner')],
    onDemand: [tool('read_file', 'runner')],
    always: [tool('get_board', 'board')],
    shared: [tool('delete_ticket', 'board')],
  };
  const names = (list: Array<{ name: string }>) => list.map((t) => t.name);

  it('always sends the core tools, whatever is chosen', () => {
    for (const selectors of [undefined, [], ['email-imap']]) {
      expect(names(splitForPreview(sources, selectors, builtin).always)).toEqual(['send_message', 'search_tools']);
    }
  });

  it("by default sends the agent's own servers, then the everyday board tools", () => {
    const { upfront, searchable } = splitForPreview(sources, undefined, builtin);
    expect(names(upfront)).toEqual(['mcp__email-imap__get_email', 'get_board']);
    expect(names(searchable)).toEqual(['mcp__brave-search__web_search', 'delete_ticket', 'read_file']);
  });

  it('keeps the everyday board tools whatever the template picks', () => {
    for (const selectors of [[], ['email-imap'], ['email-imap', 'get_board']]) {
      const picked = splitForPreview(sources, selectors, builtin);
      expect(names(picked.upfront).at(-1), String(selectors)).toBe('get_board');
      expect(names(picked.searchable)).not.toContain('get_board');
      expect(picked.unknown).toEqual([]);
    }
  });

  it('names MCP tools the way the model sees them', () => {
    expect(splitForPreview(sources, undefined, builtin).upfront[0]).toEqual(
      expect.objectContaining({ name: 'mcp__email-imap__get_email', label: 'email-imap' }));
  });
});

describe('toolTokens', () => {
  it('counts a known schema, and guesses for one the catalogue does not carry', () => {
    const schema = { name: 'x', description: 'y'.repeat(400), parameters: { type: 'object', properties: {} } };
    expect(toolTokens(schema)).toBeGreaterThan(100);
    expect(toolTokens({ name: 'x', description: 'y' })).toBe(55);
  });
});
