import { describe, it, expect } from 'vitest';
import { fillScheduleFields } from './fields.js';

const at = new Date(2026, 10, 2, 9, 5);

describe('a scheduled prompt', () => {
  it('has its date, time, human and email filled in when it fires', () => {
    expect(fillScheduleFields('On ${date} at ${time}, write to ${human} from ${email}.',
      { human: 'Paul', email: 'poppy@example.com' }, at))
      .toBe('On 2026-11-02 at 09:05, write to Paul from poppy@example.com.');
  });

  it('keeps a placeholder it has no value for, or does not know', () => {
    expect(fillScheduleFields('${email} ${result} ${date}', {}, at)).toBe('${email} ${result} 2026-11-02');
  });
});
