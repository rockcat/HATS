import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain browser module, no types
import { describeRun } from './run-now.js';

describe('describing a test run', () => {
  it('says the agent was messaged', () => {
    expect(describeRun({ delivered: true })).toBe('✓ Sent to the agent.');
    expect(describeRun({ delivered: true }, 'Poppy')).toBe('✓ Sent to Poppy.');
  });

  it('says when a condition held the message back, and shows what the tool returned', () => {
    expect(describeRun({ delivered: false, result: '[]' }, 'Poppy'))
      .toBe('– Condition not met for Poppy, so no message was sent. Tool returned: []');
  });

  it('cuts a long tool result short', () => {
    const text = describeRun({ delivered: true, result: 'x'.repeat(1000) });
    expect(text.length).toBeLessThan(400);
    expect(text.endsWith('…')).toBe(true);
  });

  it('shows a failure', () => {
    expect(describeRun({ delivered: false, error: 'no MCP servers are running' }, 'Poppy'))
      .toBe('✗ Poppy: no MCP servers are running');
  });
});
