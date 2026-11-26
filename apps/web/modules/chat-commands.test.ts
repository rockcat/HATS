import { describe, it, expect } from 'vitest';
// @ts-expect-error — a browser module, deliberately free of imports so it can be tested here.
import { chatCommand } from './chat-commands.js';

describe('commands typed into a chat', () => {
  it('runs task, reply and resume as commands', () => {
    expect(chatCommand('task Wren: fix the pricing page')).toBe('task Wren: fix the pricing page');
    expect(chatCommand('  task Wren [site]: fix it  ')).toBe('task Wren [site]: fix it');
    expect(chatCommand('reply Poppy: yes, go ahead')).toBe('reply Poppy: yes, go ahead');
    expect(chatCommand('resume')).toBe('resume');
  });

  it('sends everything else to the agent as a message', () => {
    expect(chatCommand('what is on the board today?')).toBeNull();
    expect(chatCommand('task list please')).toBeNull();        // no colon: just words
    expect(chatCommand('task Wren:')).toBeNull();               // nothing to do
    expect(chatCommand('resume the work on the pricing page')).toBeNull();
    expect(chatCommand('Task Wren: capitalised is a sentence')).toBeNull();
    expect(chatCommand('')).toBeNull();
  });
});
