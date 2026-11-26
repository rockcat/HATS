import { describe, it, expect } from 'vitest';
import { splitToolSet, unmatchedSelectors, type AvailableTools } from './tool-exposure.js';
import type { ToolDefinition } from '../providers/types.js';

const tool = (name: string): ToolDefinition => ({
  name, description: 'A tool.', parameters: { type: 'object', properties: {} },
});

const available: AvailableTools = {
  personal: [
    tool('mcp__email-imap__get_email'),
    tool('mcp__email-imap__list_emails'),
    tool('mcp__email-imap__create_label'),
    tool('mcp__google-calendar-personal__list_events'),
  ],
  shared: [
    tool('mcp__kanban__create_ticket'),
    tool('mcp__kanban__move_ticket'),
    tool('mcp__brave-search__search'),
  ],
};

const names = (list: ToolDefinition[]) => list.map((t) => t.name);

describe('splitToolSet', () => {
  it('puts every personal server in front of the model by default', () => {
    // An agent given its own mailbox should not have to discover it.
    const { upfront, searchable } = splitToolSet(available);
    expect(names(upfront)).toEqual(names(available.personal));
    expect(names(searchable)).toEqual(names(available.shared));
  });

  it('takes a whole server by id', () => {
    const { upfront } = splitToolSet(available, ['email-imap']);
    expect(names(upfront)).toEqual([
      'mcp__email-imap__get_email',
      'mcp__email-imap__list_emails',
      'mcp__email-imap__create_label',
    ]);
  });

  it('takes single tools, which is the point for a server with dozens', () => {
    const { upfront, searchable } = splitToolSet(available, [
      'email-imap:get_email', 'email-imap:list_emails',
    ]);
    expect(names(upfront)).toEqual(['mcp__email-imap__get_email', 'mcp__email-imap__list_emails']);
    // The other 47 are still reachable, just not paid for on every request.
    expect(names(searchable)).toContain('mcp__email-imap__create_label');
  });

  it('mixes servers and single tools, personal and shared alike', () => {
    const { upfront } = splitToolSet(available, ['email-imap:get_email', 'kanban']);
    expect(names(upfront)).toEqual([
      'mcp__email-imap__get_email',
      'mcp__kanban__create_ticket',
      'mcp__kanban__move_ticket',
    ]);
  });

  it('accepts the namespaced name search results print', () => {
    const { upfront } = splitToolSet(available, ['mcp__email-imap__get_email']);
    expect(names(upfront)).toEqual(['mcp__email-imap__get_email']);
  });

  it('accepts a bare tool name', () => {
    expect(names(splitToolSet(available, ['get_email']).upfront)).toEqual(['mcp__email-imap__get_email']);
  });

  it('ignores case and stray spaces', () => {
    expect(names(splitToolSet(available, ['  Email-IMAP:Get_Email  ']).upfront))
      .toEqual(['mcp__email-imap__get_email']);
  });

  it('sends nothing upfront for an empty list, which is not the same as absent', () => {
    const { upfront, searchable } = splitToolSet(available, []);
    expect(upfront).toEqual([]);
    expect(searchable).toHaveLength(7);
  });

  it('keeps every tool reachable whichever way it is split', () => {
    for (const selectors of [undefined, [], ['kanban'], ['email-imap:get_email']]) {
      const { upfront, searchable } = splitToolSet(available, selectors);
      expect([...names(upfront), ...names(searchable)].sort(), String(selectors))
        .toEqual([...names(available.personal), ...names(available.shared)].sort());
    }
  });

  it('lets a personal server win a name clash with a team one', () => {
    const clashing: AvailableTools = {
      personal: [tool('mcp__email-imap__get_email')],
      shared: [tool('mcp__email-imap__get_email'), tool('mcp__kanban__create_ticket')],
    };
    const { upfront, searchable } = splitToolSet(clashing, ['email-imap']);
    expect(names(upfront)).toEqual(['mcp__email-imap__get_email']);
    expect(names(searchable)).toEqual(['mcp__kanban__create_ticket']);
  });

  it('ignores a selector that names nothing rather than failing', () => {
    expect(names(splitToolSet(available, ['typo-server', 'email-imap:get_email']).upfront))
      .toEqual(['mcp__email-imap__get_email']);
  });

  it('sends the always tools whatever is selected, after the chosen ones', () => {
    const withBoard = { ...available, always: [tool('get_board')] };
    for (const selectors of [undefined, [], ['email-imap:get_email']]) {
      const { upfront, searchable } = splitToolSet(withBoard, selectors);
      expect(names(upfront).at(-1), String(selectors)).toBe('get_board');
      expect(names(searchable)).not.toContain('get_board');
    }
  });
});

describe('unmatchedSelectors', () => {
  it('does not call a selector for an always tool unknown', () => {
    expect(unmatchedSelectors({ ...available, always: [tool('get_board')] }, ['get_board'])).toEqual([]);
  });

  it('names a typo, which would otherwise be silent', () => {
    expect(unmatchedSelectors(available, ['email-imap:get_emails', 'kanban']))
      .toEqual(['email-imap:get_emails']);
  });

  it('is quiet when everything matched', () => {
    expect(unmatchedSelectors(available, ['email-imap', 'kanban:move_ticket'])).toEqual([]);
    expect(unmatchedSelectors(available, [])).toEqual([]);
    expect(unmatchedSelectors(available, undefined)).toEqual([]);
  });
});
