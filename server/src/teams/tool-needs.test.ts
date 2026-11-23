import { describe, expect, it } from 'vitest';
import { missingToolMessage, needsNotice, serversIn, unmetNeeds } from './tool-needs.js';

describe('serversIn', () => {
  it('names the servers that MCP tools come from, ignoring built-in tools', () => {
    expect([...serversIn(['mcp__postgres__query', 'mcp__brave-search__search', 'send_message'])])
      .toEqual(['postgres', 'brave-search']);
  });
});

describe('unmetNeeds', () => {
  it('finds the required and preferred servers that cannot be reached, ignoring case', () => {
    const reachable = new Set(['postgres']);
    expect(unmetNeeds({ tools: { required: ['Postgres', 'stripe'], preferred: ['web-search'] } }, reachable))
      .toEqual({ required: ['stripe'], preferred: ['web-search'] });
  });

  it('finds nothing missing for an agent that needs nothing', () => {
    expect(unmetNeeds(undefined, new Set())).toEqual({ required: [], preferred: [] });
  });
});

describe('needsNotice', () => {
  it('says what is missing and what to do instead', () => {
    const text = needsNotice(['postgres', 'stripe'], false);
    expect(text).toContain('You need postgres and stripe, which are not available');
    expect(text).toContain('Carry on with what you can do without it');
    expect(text).not.toContain('discover_teams');
  });

  it('points to discover_teams when the agent may look for another team', () => {
    expect(needsNotice(['postgres'], true)).toContain('discover_teams can find a team that has it');
  });
});

describe('missingToolMessage', () => {
  it('names the server of an MCP tool that is not there', () => {
    expect(missingToolMessage('mcp__postgres__query', false))
      .toMatch(/^The postgres tools are not available to you on this team, so query could not run\./);
  });

  it('says plainly when there is no such tool, and never just "unknown"', () => {
    const text = missingToolMessage('make_coffee', true);
    expect(text).toContain('There is no tool called make_coffee here.');
    expect(text).toContain('discover_teams');
    expect(text).not.toMatch(/unknown tool/i);
  });
});
