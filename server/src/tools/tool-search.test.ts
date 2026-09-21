import { describe, it, expect } from 'vitest';
import { buildToolRegistry, getTool, searchTools, serverOf } from './tool-search.js';
import type { ToolDefinition } from '../providers/types.js';

const tool = (name: string, description: string): ToolDefinition => ({
  name, description, parameters: { type: 'object', properties: {} },
});

/** A slice of what the email-imap MCP server really exposes. */
const EMAIL = [
  tool('mcp__email-imap__get_email', 'Get the full content of a specific email by ID. Does NOT mark the email as seen (uses IMAP BODY.PEEK — non-destructive).'),
  tool('mcp__email-imap__get_emails', 'Get several emails at once by ID.'),
  tool('mcp__email-imap__list_emails', 'List emails in a mailbox with pagination and filters.'),
  tool('mcp__email-imap__search_emails', 'Search emails by criteria such as sender, subject or date.'),
  tool('mcp__email-imap__get_thread', 'Get all messages in a conversation thread.'),
  tool('mcp__email-imap__download_attachment', 'Download an attachment from an email.'),
  tool('mcp__email-imap__send_email', 'Send an email to one or more recipients.'),
];

const BUILTIN = [
  tool('read_file', 'Read a file from the project folder.'),
  tool('schedule_action', 'Schedule a recurring or one-off action for later.'),
];

const registry = buildToolRegistry([...EMAIL, ...BUILTIN]);
const found = (query: string): string[] =>
  (JSON.parse(searchTools(query, registry)).results ?? []).map((r: { name: string }) => r.name);

describe('searchTools', () => {
  it('finds the tool an agent asks for in a sentence, not just a keyword', () => {
    // The bug this replaces: the whole phrase was matched as one substring, so
    // every natural query returned nothing and the agent reported it could only
    // list its mail, never read it.
    for (const query of ['read an email', 'read emails', 'open email', 'get email content', 'email body']) {
      expect(found(query), query).toContain('mcp__email-imap__get_email');
    }
  });

  it('still answers a bare keyword', () => {
    expect(found('email')).toContain('mcp__email-imap__get_email');
    expect(found('file')).toContain('read_file');
  });

  it('treats singular and plural as the same word', () => {
    expect(found('message')).toEqual(found('messages'));
    expect(found('email')).toEqual(found('emails'));
  });

  it('matches a fragment, so a half-remembered word still lands', () => {
    expect(found('attach')).toContain('mcp__email-imap__download_attachment');
    expect(found('sched')).toContain('schedule_action');
  });

  it('finds everything a server offers by naming the server', () => {
    const names = found('email-imap');
    for (const t of EMAIL) expect(names).toContain(t.name);
  });

  it('ranks a whole-name hit above a passing mention in the prose', () => {
    // send_email names the word; download_attachment only mentions it.
    const names = found('send email');
    expect(names.indexOf('mcp__email-imap__send_email'))
      .toBeLessThan(names.indexOf('mcp__email-imap__download_attachment'));
  });

  it('tells the agent which servers exist when nothing matches', () => {
    const result = JSON.parse(searchTools('quantum tunnelling', registry));
    expect(result.results).toEqual([]);
    expect(result.availableServers).toContain('email-imap');
    expect(result.toolCount).toBe(registry.size);
  });

  it('ignores a query made only of filler rather than returning nothing', () => {
    expect(found('the a tool for it')).not.toHaveLength(0);
  });

  it('reports which server a tool belongs to', () => {
    const [first] = JSON.parse(searchTools('get_email', registry)).results;
    expect(first.server).toBe('email-imap');
  });

  it('caps a very broad query and says it did', () => {
    const many = buildToolRegistry(
      Array.from({ length: 60 }, (_, i) => tool(`mcp__big__tool_${i}`, 'An email tool.')),
    );
    const result = JSON.parse(searchTools('email', many));
    expect(result.results).toHaveLength(25);
    expect(result.truncated).toBe(true);
  });
});

describe('getTool', () => {
  it('returns the schema for an exact name', () => {
    expect(getTool('mcp__email-imap__get_email', registry).found).toBe(true);
  });

  it('accepts the bare name when only one server offers it', () => {
    const result = getTool('get_email', registry);
    expect(result.found).toBe(true);
    expect(result.schema?.name).toBe('mcp__email-imap__get_email');
  });

  it('suggests near misses instead of a dead end', () => {
    const result = getTool('read_email', registry);
    expect(result.found).toBe(false);
    expect(JSON.parse(result.result).didYouMean).toContain('mcp__email-imap__get_email');
  });
});

describe('serverOf', () => {
  it('names the MCP server a tool came from', () => {
    expect(serverOf('mcp__email-imap__get_email')).toBe('email-imap');
    expect(serverOf('read_file')).toBeNull();
  });
});
