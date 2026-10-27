import { describe, it, expect } from 'vitest';
import { builtinTools } from './builtin-tools.js';

const names = (tools: Array<{ name: string }>) => tools.map((t) => t.name);

describe('builtinTools', () => {
  it('always sends the core tools, and leaves the rest to search', () => {
    const tools = builtinTools(['white']);
    expect(names(tools.core)).toContain('send_message');
    expect(names(tools.core)).toContain('search_tools');
    expect(names(tools.onDemand)).toContain('read_file');
    expect(names(tools.onDemand)).not.toContain('send_message');
  });

  it('gives a blue hat the tools for running the team', () => {
    expect(names(builtinTools(['blue']).core)).toContain('assign_task');
    expect(names(builtinTools(['white']).core)).not.toContain('assign_task');
    expect(names(builtinTools(['blue', 'red']).onDemand)).toContain('schedule_meeting');
  });

  it('always sends the everyday board tools and leaves the rest with the team\'s', () => {
    const tools = builtinTools(['white']);
    expect(names(tools.always)).toEqual(expect.arrayContaining(['get_board', 'move_ticket']));
    expect(names(tools.shared)).not.toContain('get_board');
    expect(tools.shared.length).toBeGreaterThan(0);
    expect(tools.shared.every((t) => t.source === 'board')).toBe(true);
  });

  it('keeps the people tools apart, since they depend on the runner', () => {
    expect(names(builtinTools(['white']).people)).toContain('identify_person');
    expect(names(builtinTools(['white']).always)).not.toContain('identify_person');
  });

  it('carries each tool\'s schema, for counting what it costs', () => {
    expect(builtinTools(['white']).always.every((t) => t.parameters?.type === 'object')).toBe(true);
  });

  it('ignores a hat it does not know', () => {
    expect(names(builtinTools(['nonsense']).core)).toEqual(names(builtinTools([]).core));
  });
});
