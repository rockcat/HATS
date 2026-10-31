import { describe, it, expect } from 'vitest';
import { toolTotals, toolGroups } from './agent-tools.js';

const row = (name: string, server: string | null, upfront: boolean, selectable = true, chars = 400) =>
  ({ name, server, upfront, selectable, chars, description: '', kind: selectable ? 'personal' : 'core' });

const rows = [
  row('send_message', null, true, false),
  row('mcp__email-imap__get_email', 'email-imap', true),
  row('mcp__email-imap__send_email', 'email-imap', false),
  row('kanban_delete_ticket', null, false),
];

describe("the Configure panel's tool list", () => {
  it('totals what is sent in every call and what is left to search', () => {
    expect(toolTotals(rows)).toEqual({ sent: 2, sentTokens: 200, searched: 2 });
  });

  it('puts the fixed tools first, then a group per server', () => {
    expect(toolGroups(rows).map((g) => [g.label, g.rows.length])).toEqual([
      ['Always sent', 1], ['email-imap', 2], ['Runner tools', 1],
    ]);
  });
});
