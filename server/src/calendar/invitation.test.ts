import { describe, it, expect, beforeEach } from 'vitest';
import { describeEvent, sendInvitation, sendReply, type MailAccount, type Mailer } from './invitation.js';
import { parseCalendar } from './icalendar.js';
import type { CalendarEvent } from './types.js';

type Sent = Parameters<Mailer['sendMail']>[0];

class FakeMailer implements Mailer {
  sent: Sent[] = [];
  async sendMail(message: Sent) { this.sent.push(message); return {}; }
  get last() { return this.sent[this.sent.length - 1]!; }
  /** The calendar part, as a client would find it. */
  get calendarPart() {
    return this.last.alternatives?.find((a) => a.contentType.includes('text/calendar'));
  }
}

const account: MailAccount = {
  address: 'poppy@example.com', displayName: 'Poppy',
  host: 'smtp.example.com', port: 587, secure: false,
  user: 'poppy@example.com', password: 'hunter2',
};

const meeting: CalendarEvent = {
  uid: 'abc-123@hats',
  summary: 'Design review',
  start: new Date('2026-10-20T14:00:00Z'),
  end: new Date('2026-10-20T15:00:00Z'),
  location: 'Room 2',
  organiser: { email: 'poppy@example.com', name: 'Poppy' },
  attendees: [
    { email: 'paul@example.com', name: 'Paul', status: 'NEEDS-ACTION' },
    { email: 'rhoda@example.com', name: 'Rhoda', status: 'NEEDS-ACTION' },
  ],
};

let mailer: FakeMailer;
beforeEach(() => { mailer = new FakeMailer(); });

describe('sending an invitation', () => {
  it('goes to everyone invited', async () => {
    const to = await sendInvitation(mailer, account, meeting, 'REQUEST');

    expect(to).toEqual(['paul@example.com', 'rhoda@example.com']);
    expect(mailer.last.to).toBe('paul@example.com, rhoda@example.com');
  });

  it('does not invite the organiser to their own meeting', async () => {
    const withSelf = {
      ...meeting,
      attendees: [...meeting.attendees!, { email: 'poppy@example.com', status: 'ACCEPTED' as const }],
    };
    expect(await sendInvitation(mailer, account, withSelf, 'REQUEST'))
      .not.toContain('poppy@example.com');
  });

  it('sends nothing when nobody else is invited', async () => {
    // A private appointment is not an email anyone needs.
    const alone = { ...meeting, attendees: [] };
    expect(await sendInvitation(mailer, account, alone, 'REQUEST')).toEqual([]);
    expect(mailer.sent).toHaveLength(0);
  });

  it('carries method=REQUEST on the content type itself', async () => {
    // Without it, clients treat the part as a file to download rather than an
    // invitation to accept.
    await sendInvitation(mailer, account, meeting, 'REQUEST');
    expect(mailer.calendarPart?.contentType).toContain('method=REQUEST');
  });

  it('offers the calendar as an alternative to the text, not beside it', async () => {
    // Same information, two forms: the text is what a client without calendar
    // support shows.
    await sendInvitation(mailer, account, meeting, 'REQUEST');

    expect(mailer.last.alternatives).toHaveLength(1);
    expect(mailer.last.text).toContain('Design review');
    expect(mailer.last.text).toContain('Room 2');
  });

  it('attaches it as well, for clients that only notice the file', async () => {
    await sendInvitation(mailer, account, meeting, 'REQUEST');
    expect(mailer.last.attachments?.[0]?.filename).toBe('invite.ics');
  });

  it('sends a calendar the far end can actually read', async () => {
    await sendInvitation(mailer, account, meeting, 'REQUEST');
    const { method, events } = parseCalendar(mailer.calendarPart!.content);

    expect(method).toBe('REQUEST');
    expect(events[0]?.uid).toBe('abc-123@hats');
    expect(events[0]?.attendees).toHaveLength(2);
  });

  it('sends from the agent, with its name', async () => {
    await sendInvitation(mailer, account, meeting, 'REQUEST');
    expect(mailer.last.from).toBe('"Poppy" <poppy@example.com>');
  });

  it('says it is an invitation in the subject', async () => {
    await sendInvitation(mailer, account, meeting, 'REQUEST');
    expect(mailer.last.subject).toBe('Invitation: Design review');
  });

  it('says it is an update once the event has been changed', async () => {
    // Otherwise a reschedule reads as a duplicate invitation.
    await sendInvitation(mailer, account, { ...meeting, sequence: 1 }, 'REQUEST');

    expect(mailer.last.subject).toBe('Updated: Design review');
    expect(mailer.last.text).toContain('has been updated');
  });
});

describe('cancelling', () => {
  it('says so in the subject and the body', async () => {
    await sendInvitation(mailer, account, { ...meeting, status: 'CANCELLED', sequence: 1 }, 'CANCEL');

    expect(mailer.last.subject).toBe('Cancelled: Design review');
    expect(mailer.last.text).toContain('has been cancelled');
  });

  it('carries method=CANCEL, which is what removes it from their diary', async () => {
    await sendInvitation(mailer, account, { ...meeting, status: 'CANCELLED' }, 'CANCEL');
    expect(mailer.calendarPart?.contentType).toContain('method=CANCEL');
    expect(parseCalendar(mailer.calendarPart!.content).method).toBe('CANCEL');
  });
});

describe('answering an invitation', () => {
  const theirs: CalendarEvent = {
    ...meeting,
    organiser: { email: 'paul@example.com', name: 'Paul' },
    attendees: [
      { email: 'poppy@example.com', name: 'Poppy', status: 'NEEDS-ACTION' },
      { email: 'rhoda@example.com', name: 'Rhoda', status: 'NEEDS-ACTION' },
    ],
  };

  it('replies to the organiser, not to the guest list', async () => {
    expect(await sendReply(mailer, account, theirs, 'ACCEPTED')).toBe('paul@example.com');
    expect(mailer.last.to).toBe('paul@example.com');
  });

  it('carries only this agent, with its answer', async () => {
    // Sending the whole guest list back makes the organiser's calendar think
    // everyone answered at once, several of them wrongly.
    await sendReply(mailer, account, theirs, 'ACCEPTED');
    const { events } = parseCalendar(mailer.calendarPart!.content);

    expect(events[0]?.attendees).toHaveLength(1);
    expect(events[0]?.attendees?.[0]?.email).toBe('poppy@example.com');
    expect(events[0]?.attendees?.[0]?.status).toBe('ACCEPTED');
  });

  it('keeps the uid, which is what ties the answer to the meeting', async () => {
    await sendReply(mailer, account, theirs, 'DECLINED');
    expect(parseCalendar(mailer.calendarPart!.content).events[0]?.uid).toBe('abc-123@hats');
  });

  it('carries method=REPLY', async () => {
    await sendReply(mailer, account, theirs, 'ACCEPTED');
    expect(mailer.calendarPart?.contentType).toContain('method=REPLY');
  });

  it('says which way it went, in the subject', async () => {
    await sendReply(mailer, account, theirs, 'ACCEPTED');
    expect(mailer.last.subject).toBe('Accepted: Design review');

    await sendReply(mailer, account, theirs, 'DECLINED');
    expect(mailer.last.subject).toBe('Declined: Design review');

    await sendReply(mailer, account, theirs, 'TENTATIVE');
    expect(mailer.last.subject).toBe('Tentative: Design review');
  });

  it('does not ask for an answer to an answer', async () => {
    await sendReply(mailer, account, theirs, 'ACCEPTED');
    expect(mailer.calendarPart?.content).not.toContain('RSVP=TRUE');
  });

  it('cannot reply to an event with no organiser', async () => {
    const orphan = { ...theirs, organiser: undefined };
    expect(await sendReply(mailer, account, orphan, 'ACCEPTED')).toBeNull();
    expect(mailer.sent).toHaveLength(0);
  });
});

describe('the words a human reads', () => {
  it('gives the time in a form somebody can act on', () => {
    const text = describeEvent(meeting, 'You are invited to:');
    expect(text).toContain('Tuesday');
    expect(text).toContain('14:00');
    expect(text).toContain('UTC');
  });

  it('lists who else was asked', () => {
    expect(describeEvent(meeting, 'x')).toContain('Invited: Paul, Rhoda');
  });

  it('copes with an event with no extras', () => {
    const bare: CalendarEvent = {
      uid: 'x@y', summary: 'Quick chat',
      start: new Date('2026-10-20T14:00:00Z'), end: new Date('2026-10-20T14:15:00Z'),
    };
    expect(describeEvent(bare, 'You are invited to:')).toContain('Quick chat');
  });
});
