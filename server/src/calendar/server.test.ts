import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { handleCall, mailAccountFromEnv, toolsFor, type CalendarServerOptions } from './server.js';
import { CalendarStore } from './store.js';
import { buildCalendar } from './icalendar.js';
import type { MailAccount, Mailer } from './invitation.js';
import type { CalendarEvent } from './types.js';

type Sent = Parameters<Mailer['sendMail']>[0];

class FakeMailer implements Mailer {
  sent: Sent[] = [];
  async sendMail(message: Sent) { this.sent.push(message); return {}; }
  get last() { return this.sent[this.sent.length - 1]!; }
  get method() {
    return this.last.alternatives?.[0]?.contentType.match(/method=(\w+)/)?.[1];
  }
}

const account: MailAccount = {
  address: 'poppy@example.com', displayName: 'Poppy',
  host: 'smtp.example.com', port: 587, secure: false,
  user: 'poppy@example.com', password: 'x',
};

const dirs: string[] = [];
let store: CalendarStore;
let mailer: FakeMailer;
let withMail: CalendarServerOptions;
let withoutMail: CalendarServerOptions;

beforeEach(async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hats-calsrv-'));
  dirs.push(dir);
  store = new CalendarStore(path.join(dir, 'calendar.ics'));
  mailer = new FakeMailer();
  withMail = { store, account, mailer: () => mailer };
  withoutMail = { store, account: null };
});
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const call = (opts: CalendarServerOptions, name: string, args: Record<string, unknown> = {}) =>
  handleCall(opts, name, args);

const uidOf = (text: string) => text.match(/\[([^\]]+)\]/)?.[1] ?? '';

describe('what the agent is offered', () => {
  it('offers the calendar tools with no email account', () => {
    const names = toolsFor(false).map((t) => t.name);
    expect(names).toContain('create_event');
    expect(names).toContain('find_free_time');
  });

  it('does not offer to answer invitations without one', () => {
    // A tool that can only fail is one the agent calls over and over.
    expect(toolsFor(false).map((t) => t.name)).not.toContain('respond_to_invitation');
    expect(toolsFor(true).map((t) => t.name)).toContain('respond_to_invitation');
  });

  it('says plainly that attendees cannot be invited without mail', () => {
    const create = toolsFor(false).find((t) => t.name === 'create_event');
    expect(create?.description).toContain('no email account');
  });
});

describe('reading a mail account out of the environment', () => {
  it('builds one from the email server\'s own settings', () => {
    // The same variable names email-imap uses, so configuring email once is
    // enough for both.
    const found = mailAccountFromEnv({
      MCP_EMAIL_ADDRESS: 'p@e.com', MCP_EMAIL_SMTP_HOST: 'smtp.e.com',
      MCP_EMAIL_PASSWORD: 'pw', MCP_EMAIL_FULL_NAME: 'Poppy',
    } as NodeJS.ProcessEnv);

    expect(found?.address).toBe('p@e.com');
    expect(found?.displayName).toBe('Poppy');
    expect(found?.port).toBe(587);
  });

  it('treats 465 as implicit TLS', () => {
    const found = mailAccountFromEnv({
      MCP_EMAIL_ADDRESS: 'p@e.com', MCP_EMAIL_SMTP_HOST: 'smtp.e.com',
      MCP_EMAIL_PASSWORD: 'pw', MCP_EMAIL_SMTP_PORT: '465',
    } as NodeJS.ProcessEnv);
    expect(found?.secure).toBe(true);
  });

  it('falls back to the address when there is no separate username', () => {
    const found = mailAccountFromEnv({
      MCP_EMAIL_ADDRESS: 'p@e.com', MCP_EMAIL_SMTP_HOST: 'smtp.e.com', MCP_EMAIL_PASSWORD: 'pw',
    } as NodeJS.ProcessEnv);
    expect(found?.user).toBe('p@e.com');
  });

  it('has no account when anything essential is missing', () => {
    expect(mailAccountFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
    expect(mailAccountFromEnv({ MCP_EMAIL_ADDRESS: 'p@e.com' } as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe('putting something in the calendar', () => {
  it('adds an event and says so', async () => {
    const out = await call(withMail, 'create_event', {
      summary: 'Standup', start: '2026-10-20T09:00:00Z', end: '2026-10-20T09:15:00Z',
    });

    expect(out).toContain('Added to your calendar');
    expect((await store.all())[0]?.summary).toBe('Standup');
  });

  it('gives an event with no end the hour everyone means', async () => {
    await call(withMail, 'create_event', { summary: 'Chat', start: '2026-10-20T09:00:00Z' });
    const event = (await store.all())[0]!;
    expect(event.end.getTime() - event.start.getTime()).toBe(3_600_000);
  });

  it('refuses an event that ends before it starts', async () => {
    await expect(call(withMail, 'create_event', {
      summary: 'Backwards', start: '2026-10-20T10:00:00Z', end: '2026-10-20T09:00:00Z',
    })).rejects.toThrow(/ends before it starts/);
  });

  it('says which date it could not read, rather than storing an invalid one', async () => {
    await expect(call(withMail, 'create_event', { summary: 'x', start: 'next tuesday' }))
      .rejects.toThrow(/not a date I can read/);
  });

  it('sends no email when nobody is invited', async () => {
    await call(withMail, 'create_event', { summary: 'Think', start: '2026-10-20T09:00:00Z' });
    expect(mailer.sent).toHaveLength(0);
  });

  it('invites the people named, and says who it told', async () => {
    const out = await call(withMail, 'create_event', {
      summary: 'Design review', start: '2026-10-20T14:00:00Z',
      attendees: ['paul@example.com', 'rhoda@example.com'],
    });

    expect(out).toContain('invited paul@example.com, rhoda@example.com');
    expect(mailer.method).toBe('REQUEST');
  });

  it('admits it cannot invite anyone without an email account', async () => {
    const out = await call(withoutMail, 'create_event', {
      summary: 'Design review', start: '2026-10-20T14:00:00Z', attendees: ['paul@example.com'],
    });

    expect(out).toContain('no email account');
    expect(out).toContain('nobody was invited');
  });
});

describe('listing what is on', () => {
  it('says plainly when there is nothing', async () => {
    expect(await call(withMail, 'list_events')).toContain('Nothing in your calendar');
  });

  it('shows an event with its id, so it can be acted on', async () => {
    await call(withMail, 'create_event', { summary: 'Standup', start: '2026-10-20T09:00:00Z' });
    const out = await call(withMail, 'list_events', { from: '2026-10-20T00:00:00Z', to: '2026-10-21T00:00:00Z' });

    expect(out).toContain('Standup');
    expect(uidOf(out)).toMatch(/@hats$/);
  });

  it('leaves out what falls outside the window', async () => {
    await call(withMail, 'create_event', { summary: 'Far off', start: '2027-01-01T09:00:00Z' });
    const out = await call(withMail, 'list_events', { from: '2026-10-20T00:00:00Z', to: '2026-10-21T00:00:00Z' });

    expect(out).toContain('Nothing in your calendar');
  });

  it('shows who has answered and how', async () => {
    const made = await call(withMail, 'create_event', {
      summary: 'Review', start: '2026-10-20T14:00:00Z', attendees: ['paul@example.com'],
    });
    await store.recordResponse(uidOf(made), 'paul@example.com', 'ACCEPTED');

    const out = await call(withMail, 'list_events', { from: '2026-10-20T00:00:00Z', to: '2026-10-21T00:00:00Z' });
    expect(out).toContain('paul@example.com (accepted)');
  });
});

describe('changing and cancelling', () => {
  const makeWithGuest = () => call(withMail, 'create_event', {
    summary: 'Review', start: '2026-10-20T14:00:00Z', attendees: ['paul@example.com'],
  });

  it('tells the guests about a change', async () => {
    const uid = uidOf(await makeWithGuest());
    mailer.sent = [];

    const out = await call(withMail, 'update_event', { uid, start: '2026-10-20T16:00:00Z' });

    expect(out).toContain('told paul@example.com');
    expect(mailer.method).toBe('REQUEST');
  });

  it('bumps the sequence so their calendar accepts the change', async () => {
    const uid = uidOf(await makeWithGuest());
    await call(withMail, 'update_event', { uid, summary: 'Review (moved)' });

    expect((await store.find(uid))?.sequence).toBe(1);
  });

  it('keeps the length when only the start moves', async () => {
    // Any calendar does this. Leaving the old end behind gives either a
    // backwards event or a silently much longer one.
    const made = await call(withMail, 'create_event', {
      summary: 'Review', start: '2026-10-20T14:00:00Z', end: '2026-10-20T15:00:00Z',
    });
    const uid = uidOf(made);

    await call(withMail, 'update_event', { uid, start: '2026-10-20T16:00:00Z' });

    const event = (await store.find(uid))!;
    expect(event.start.toISOString()).toBe('2026-10-20T16:00:00.000Z');
    expect(event.end.toISOString()).toBe('2026-10-20T17:00:00.000Z');
  });

  it('leaves the calendar alone when a change is rejected', async () => {
    const made = await call(withMail, 'create_event', {
      summary: 'Review', start: '2026-10-20T14:00:00Z', end: '2026-10-20T15:00:00Z',
    });
    const uid = uidOf(made);

    await expect(call(withMail, 'update_event', { uid, end: '2026-10-20T13:00:00Z' }))
      .rejects.toThrow(/end the event before it starts/);

    const event = (await store.find(uid))!;
    expect(event.end.toISOString()).toBe('2026-10-20T15:00:00.000Z');
    expect(event.sequence ?? 0).toBe(0);
  });

  it('says so when there is no such event', async () => {
    expect(await call(withMail, 'update_event', { uid: 'nope', summary: 'x' }))
      .toContain('No event with id nope');
  });

  it('sends a cancellation rather than silently deleting', async () => {
    const uid = uidOf(await makeWithGuest());
    mailer.sent = [];

    const out = await call(withMail, 'cancel_event', { uid });

    expect(out).toContain('told paul@example.com');
    expect(mailer.method).toBe('CANCEL');
    expect((await store.find(uid))?.status).toBe('CANCELLED');
  });

  it('cancels a private event without emailing anyone', async () => {
    const made = await call(withMail, 'create_event', { summary: 'Dentist', start: '2026-10-20T11:00:00Z' });
    mailer.sent = [];

    expect(await call(withMail, 'cancel_event', { uid: uidOf(made) })).toContain('Cancelled "Dentist"');
    expect(mailer.sent).toHaveLength(0);
  });
});

describe('finding a gap', () => {
  it('offers the first free slot', async () => {
    await call(withMail, 'create_event', {
      summary: 'Busy', start: '2026-10-20T09:00:00Z', end: '2026-10-20T10:00:00Z',
    });

    const out = await call(withMail, 'find_free_time', {
      minutes: 60, from: '2026-10-20T09:00:00Z', to: '2026-10-20T17:00:00Z',
    });
    expect(out).toContain('2026-10-20T10:00:00.000Z');
  });

  it('says plainly when there is no room', async () => {
    await call(withMail, 'create_event', {
      summary: 'All day', start: '2026-10-20T09:00:00Z', end: '2026-10-20T17:00:00Z',
    });

    const out = await call(withMail, 'find_free_time', {
      minutes: 60, from: '2026-10-20T09:00:00Z', to: '2026-10-20T17:00:00Z',
    });
    expect(out).toContain('No free 60-minute slot');
  });

  it('asks for a length rather than guessing one', async () => {
    await expect(call(withMail, 'find_free_time', { minutes: 0 })).rejects.toThrow(/how many minutes/i);
  });
});

describe('an invitation arriving by email', () => {
  const theirMeeting: CalendarEvent = {
    uid: 'their-123@example.com',
    summary: 'Budget review',
    start: new Date('2026-10-22T10:00:00Z'),
    end: new Date('2026-10-22T11:00:00Z'),
    organiser: { email: 'paul@example.com', name: 'Paul' },
    attendees: [{ email: 'poppy@example.com', status: 'NEEDS-ACTION' }],
  };

  it('files a request as unanswered, and says how to answer', async () => {
    const out = await call(withMail, 'receive_invitation', {
      ics: buildCalendar([theirMeeting], 'REQUEST'),
    });

    expect(out).toContain('Added "Budget review"');
    expect(out).toContain('respond_to_invitation');
    expect(await store.find('their-123@example.com')).toBeDefined();
  });

  it('updates an event it already has rather than duplicating it', async () => {
    await call(withMail, 'receive_invitation', { ics: buildCalendar([theirMeeting], 'REQUEST') });
    const out = await call(withMail, 'receive_invitation', {
      ics: buildCalendar([{ ...theirMeeting, summary: 'Budget review (moved)', sequence: 1 }], 'REQUEST'),
    });

    expect(out).toContain('Updated');
    expect(await store.all()).toHaveLength(1);
  });

  it('records somebody answering an event we organise', async () => {
    const made = await call(withMail, 'create_event', {
      summary: 'Review', start: '2026-10-20T14:00:00Z', attendees: ['paul@example.com'],
    });
    const uid = uidOf(made);

    const reply = buildCalendar([{
      uid, summary: 'Review',
      start: new Date('2026-10-20T14:00:00Z'), end: new Date('2026-10-20T15:00:00Z'),
      attendees: [{ email: 'paul@example.com', name: 'Paul', status: 'ACCEPTED' }],
    }], 'REPLY');

    expect(await call(withMail, 'receive_invitation', { ics: reply })).toContain('accepted');
    expect((await store.find(uid))?.attendees?.[0]?.status).toBe('ACCEPTED');
  });

  it('says so when a reply is for something not in the calendar', async () => {
    const reply = buildCalendar([{
      uid: 'unknown@x', summary: 'Mystery',
      start: new Date('2026-10-20T14:00:00Z'), end: new Date('2026-10-20T15:00:00Z'),
      attendees: [{ email: 'paul@example.com', status: 'ACCEPTED' }],
    }], 'REPLY');

    expect(await call(withMail, 'receive_invitation', { ics: reply })).toContain('not in your calendar');
  });

  it('marks an event cancelled by its organiser', async () => {
    await call(withMail, 'receive_invitation', { ics: buildCalendar([theirMeeting], 'REQUEST') });
    const out = await call(withMail, 'receive_invitation', {
      ics: buildCalendar([{ ...theirMeeting, status: 'CANCELLED' }], 'CANCEL'),
    });

    expect(out).toContain('has been cancelled by the organiser');
    expect((await store.find('their-123@example.com'))?.status).toBe('CANCELLED');
  });

  it('says plainly when the text is not a calendar at all', async () => {
    expect(await call(withMail, 'receive_invitation', { ics: 'Dear Poppy, are you free?' }))
      .toContain('does not contain a calendar event');
  });
});

describe('answering an invitation', () => {
  const fileOne = async () => {
    const ics = buildCalendar([{
      uid: 'their-123@example.com', summary: 'Budget review',
      start: new Date('2026-10-22T10:00:00Z'), end: new Date('2026-10-22T11:00:00Z'),
      organiser: { email: 'paul@example.com', name: 'Paul' },
      attendees: [{ email: 'poppy@example.com', status: 'NEEDS-ACTION' }],
    }], 'REQUEST');
    await call(withMail, 'receive_invitation', { ics });
    mailer.sent = [];
    return 'their-123@example.com';
  };

  it('tells the organiser, and records it', async () => {
    const uid = await fileOne();
    const out = await call(withMail, 'respond_to_invitation', { uid, response: 'ACCEPTED' });

    expect(out).toContain('Told paul@example.com you accepted');
    expect(mailer.method).toBe('REPLY');
    const mine = (await store.find(uid))?.attendees
      ?.find((a) => a.email === 'poppy@example.com');
    expect(mine?.status).toBe('ACCEPTED');
  });

  it('keeps a declined invitation, marked', async () => {
    // Still worth knowing what was asked and what was said.
    const uid = await fileOne();
    await call(withMail, 'respond_to_invitation', { uid, response: 'DECLINED' });

    const event = await store.find(uid);
    expect(event).toBeDefined();
    expect(event?.attendees?.find((a) => a.email === 'poppy@example.com')?.status).toBe('DECLINED');
  });

  it('accepts any of the three answers, in any case', async () => {
    const uid = await fileOne();
    expect(await call(withMail, 'respond_to_invitation', { uid, response: 'tentative' }))
      .toContain('tentative');
  });

  it('refuses an answer that is not one of them', async () => {
    const uid = await fileOne();
    await expect(call(withMail, 'respond_to_invitation', { uid, response: 'maybe' }))
      .rejects.toThrow(/ACCEPTED, DECLINED, TENTATIVE/);
  });

  it('says so when there is nothing to answer', async () => {
    expect(await call(withMail, 'respond_to_invitation', { uid: 'nope', response: 'ACCEPTED' }))
      .toContain('No event with id nope');
  });
});

describe('an unknown tool', () => {
  it('says which one', async () => {
    await expect(call(withMail, 'make_tea')).rejects.toThrow(/Unknown tool: make_tea/);
  });
});
