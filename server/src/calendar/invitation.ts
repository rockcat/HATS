// ── Invitations over plain email ──────────────────────────────────────────────
//
// RFC 6047, iMIP. An invitation is an ordinary email carrying a
// `text/calendar` part whose `method` parameter says what it is: REQUEST to
// invite, REPLY to answer, CANCEL to call it off. Outlook, Gmail and Apple
// Mail all read it, which is what lets an agent put something in a human's
// diary without either of them sharing a platform.
//
// The MIME details are what make the difference between a real invitation and
// an email with a file stuck to it:
//
//  * The calendar part needs `method=` on its own content type, not just in
//    the body. Without it clients treat it as an attachment to download.
//  * It is an alternative to the text body, not an attachment beside it: the
//    text is what someone sees in a client that cannot read calendars.
//  * A REPLY must carry only the replying attendee, with their PARTSTAT.
//    Sending the whole guest list back confuses the organiser's calendar.

import { buildCalendar } from './icalendar.js';
import type { CalendarEvent, Participation } from './types.js';

/** What the calendar server needs to send mail as its agent. */
export interface MailAccount {
  address: string;
  displayName?: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
}

/** The minimum of nodemailer we use, so a test needs no socket. */
export interface Mailer {
  sendMail(message: {
    from: string; to: string; subject: string; text: string;
    alternatives?: Array<{ contentType: string; content: string }>;
    attachments?: Array<{ filename: string; content: string; contentType: string }>;
    icalEvent?: { method: string; content: string };
  }): Promise<unknown>;
}

const when = (event: CalendarEvent) => {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: 'long', day: 'numeric', month: 'long',
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false,
  };
  const start = new Intl.DateTimeFormat('en-GB', opts).format(event.start);
  const end = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false,
  }).format(event.end);
  return `${start}–${end} UTC`;
};

/** The plain-text body, for anyone whose client cannot read the calendar part. */
export function describeEvent(event: CalendarEvent, lead: string): string {
  const lines = [lead, '', event.summary, when(event)];
  if (event.location) lines.push(`Location: ${event.location}`);
  if (event.description) lines.push('', event.description);
  const guests = (event.attendees ?? []).map((a) => a.name ?? a.email);
  if (guests.length) lines.push('', `Invited: ${guests.join(', ')}`);
  return lines.join('\n') + '\n';
}

const subjectFor = (event: CalendarEvent, method: string, replier?: Participation) => {
  if (method === 'CANCEL') return `Cancelled: ${event.summary}`;
  if (method === 'REPLY') {
    const word = replier === 'ACCEPTED' ? 'Accepted' : replier === 'DECLINED' ? 'Declined' : 'Tentative';
    return `${word}: ${event.summary}`;
  }
  return (event.sequence ?? 0) > 0 ? `Updated: ${event.summary}` : `Invitation: ${event.summary}`;
};

/**
 * Send an invitation, an update, or a cancellation to everyone invited.
 *
 * Returns the addresses it went to, so the caller can tell the agent who was
 * actually told rather than implying everyone was.
 */
export async function sendInvitation(
  mailer: Mailer, account: MailAccount, event: CalendarEvent,
  method: 'REQUEST' | 'CANCEL',
): Promise<string[]> {
  const recipients = (event.attendees ?? [])
    .map((a) => a.email)
    .filter((email) => email.toLowerCase() !== account.address.toLowerCase());
  if (recipients.length === 0) return [];

  const ics = buildCalendar([event], method);
  const lead = method === 'CANCEL'
    ? 'This meeting has been cancelled.'
    : (event.sequence ?? 0) > 0 ? 'This meeting has been updated.' : 'You are invited to:';

  await mailer.sendMail({
    from: account.displayName ? `"${account.displayName}" <${account.address}>` : account.address,
    to: recipients.join(', '),
    subject: subjectFor(event, method),
    text: describeEvent(event, lead),
    // An alternative rather than an attachment: this is the same information
    // as the text, in a form a calendar can act on.
    alternatives: [{ contentType: `text/calendar; charset=UTF-8; method=${method}`, content: ics }],
    // Also attached, because a few clients only notice the file.
    attachments: [{ filename: 'invite.ics', content: ics, contentType: `text/calendar; method=${method}` }],
  });

  return recipients;
}

/**
 * Answer someone else's invitation.
 *
 * The reply carries only this agent's own attendee line. Sending the whole
 * guest list back makes the organiser's calendar think everyone answered at
 * once, and some of them answered with the wrong status.
 */
export async function sendReply(
  mailer: Mailer, account: MailAccount, event: CalendarEvent, status: Participation,
): Promise<string | null> {
  const organiser = event.organiser?.email;
  if (!organiser) return null;

  const reply: CalendarEvent = {
    ...event,
    attendees: [{
      email: account.address,
      ...(account.displayName ? { name: account.displayName } : {}),
      status,
      rsvp: false,
    }],
    stamp: new Date(),
  };

  const word = status === 'ACCEPTED' ? 'accepted' : status === 'DECLINED' ? 'declined' : 'tentatively accepted';
  const ics = buildCalendar([reply], 'REPLY');

  await mailer.sendMail({
    from: account.displayName ? `"${account.displayName}" <${account.address}>` : account.address,
    to: organiser,
    subject: subjectFor(event, 'REPLY', status),
    text: `${account.displayName ?? account.address} has ${word} this invitation.\n\n`
      + `${event.summary}\n${when(event)}\n`,
    alternatives: [{ contentType: 'text/calendar; charset=UTF-8; method=REPLY', content: ics }],
    attachments: [{ filename: 'reply.ics', content: ics, contentType: 'text/calendar; method=REPLY' }],
  });

  return organiser;
}
