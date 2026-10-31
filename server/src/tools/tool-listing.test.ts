import { describe, it, expect } from 'vitest';
import { toolRows, selectorsFor } from './tool-listing.js';
import { splitToolSet, type AvailableTools } from './tool-exposure.js';
import type { ToolDefinition } from '../providers/types.js';

const tool = (name: string): ToolDefinition => ({ name, description: `does ${name}`, parameters: { type: 'object', properties: {} } });

const available: AvailableTools = {
  personal: [tool('mcp__email-imap__get_email'), tool('mcp__email-imap__send_email')],
  shared: [tool('mcp__brave-search__web_search'), tool('kanban_delete_ticket')],
  always: [tool('kanban_get_board')],
};
const core = [tool('send_message')];

describe("an agent's tools, as the Configure panel lists them", () => {
  it('shows the default: personal tools sent, shared ones searched for', () => {
    const rows = toolRows(core, available, splitToolSet(available, undefined));
    const sent = rows.filter((r) => r.upfront).map((r) => r.name);
    expect(sent).toEqual(['send_message', 'kanban_get_board', 'mcp__email-imap__get_email', 'mcp__email-imap__send_email']);
  });

  it('lets only MCP and board tools be changed, never the core or hot-path ones', () => {
    const rows = toolRows(core, available, splitToolSet(available, undefined));
    expect(rows.filter((r) => !r.selectable).map((r) => r.kind)).toEqual(['core', 'always']);
  });

  it('gives each tool its size, so the panel can total what is sent', () => {
    const rows = toolRows(core, available, splitToolSet(available, undefined));
    expect(rows.every((r) => r.chars > 0)).toBe(true);
  });
});

describe('turning ticks back into selectors', () => {
  const rows = toolRows(core, available, splitToolSet(available, undefined));

  it('names a server whole when all of it is ticked', () => {
    expect(selectorsFor(rows, ['mcp__email-imap__get_email', 'mcp__email-imap__send_email'])).toEqual(['email-imap']);
  });

  it('names single tools otherwise, and runner tools by name', () => {
    expect(selectorsFor(rows, ['mcp__email-imap__get_email', 'kanban_delete_ticket']).sort())
      .toEqual(['email-imap:get_email', 'kanban_delete_ticket']);
  });

  it('round-trips: the selectors send exactly what was ticked', () => {
    const ticked = ['mcp__email-imap__send_email', 'mcp__brave-search__web_search'];
    const split = splitToolSet(available, selectorsFor(rows, ticked));
    const sentMcp = split.upfront.map((t) => t.name).filter((n) => n !== 'kanban_get_board');
    expect(sentMcp.sort()).toEqual([...ticked].sort());
  });

  it('can send none of them', () => {
    expect(selectorsFor(rows, [])).toEqual([]);
  });
});
