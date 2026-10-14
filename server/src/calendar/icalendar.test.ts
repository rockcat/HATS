import { describe, it, expect } from 'vitest';
import {
  buildCalendar, escapeText, foldLine, formatUtc, parseCalendar, parseIcsDate,
  parseLine, unescapeText, unfold,
} from './icalendar.js';
import type { CalendarEvent } from './types.js';

const meeting: CalendarEvent = {
  uid: 'abc-123@hats',
  summary: 'Sprint planning',
  start: new Date('2026-10-14T09:30:00Z'),
  end: new Date('2026-10-14T10:30:00Z'),
  organiser: { email: 'poppy@example.com', name: 'Poppy' },
  attendees: [
    { email: 'paul@example.com', name: 'Paul', status: 'NEEDS-ACTION' },
  ],
  stamp: new Date('2026-10-13T08:00:00Z'),
};

describe('writing an instant', () => {
  it('writes UTC the way the spec wants it', () => {
    expect(formatUtc(new Date('2026-10-14T09:30:00Z'))).toBe('20261014T093000Z');
  });

  it('pads every field', () => {
    expect(formatUtc(new Date('2026-01-02T03:04:05Z'))).toBe('20260102T030405Z');
  });
});

describe('escaping a text value', () => {
  it('escapes the four characters that matter', () => {
    expect(escapeText('a;b,c\\d\ne')).toBe('a\\;b\\,c\\\\d\\ne');
  });

  it('escapes backslashes before anything else', () => {
    // The other order escapes the escapes and corrupts the value.
    expect(escapeText('\\;')).toBe('\\\\\\;');
  });

  it('round-trips', () => {
    const awkward = 'Review: costs, risks; and "scope"\nsecond line \\ backslash';
    expect(unescapeText(escapeText(awkward))).toBe(awkward);
  });

  it('treats CRLF as one newline', () => {
    expect(unescapeText(escapeText('a\r\nb'))).toBe('a\nb');
  });
});

describe('folding long lines', () => {
  it('leaves a short line alone', () => {
    expect(foldLine('SUMMARY:Standup')).toBe('SUMMARY:Standup');
  });

  it('folds at 75 octets with a leading space on continuations', () => {
    const folded = foldLine('SUMMARY:' + 'x'.repeat(200));
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    expect(Buffer.from(parts[0]!, 'utf8').length).toBeLessThanOrEqual(75);
    for (const part of parts.slice(1)) expect(part.startsWith(' ')).toBe(true);
  });

  it('does not split a multi-byte character down the middle', () => {
    // A summary with an emoji or an accent folded mid-character produces a
    // file some parsers reject and others render as mojibake.
    const folded = foldLine('SUMMARY:' + 'é'.repeat(80));
    expect(unfold(folded).join('')).toBe('SUMMARY:' + 'é'.repeat(80));
    expect(folded).not.toContain('�');
  });

  it('survives a round trip through unfold', () => {
    const line = 'DESCRIPTION:' + 'The quick brown fox. '.repeat(20);
    expect(unfold(foldLine(line))).toEqual([line]);
  });
});

describe('splitting a property line', () => {
  it('reads name, parameters and value', () => {
    const parsed = parseLine('ATTENDEE;CN=Paul;PARTSTAT=ACCEPTED:mailto:paul@example.com');
    expect(parsed?.name).toBe('ATTENDEE');
    expect(parsed?.params).toEqual({ CN: 'Paul', PARTSTAT: 'ACCEPTED' });
    expect(parsed?.value).toBe('mailto:paul@example.com');
  });

  it('does not stop at a colon inside a quoted parameter', () => {
    // Real senders quote display names, and a name can contain anything.
    const parsed = parseLine('ATTENDEE;CN="Smith: Paul":mailto:paul@example.com');
    expect(parsed?.params['CN']).toBe('Smith: Paul');
    expect(parsed?.value).toBe('mailto:paul@example.com');
  });

  it('does not treat a semicolon inside quotes as a separator', () => {
    const parsed = parseLine('ATTENDEE;CN="Paul; Esq":mailto:p@e.com');
    expect(parsed?.params['CN']).toBe('Paul; Esq');
  });

  it('uppercases parameter names, which are case-insensitive', () => {
    expect(parseLine('ATTENDEE;partstat=ACCEPTED:mailto:p@e.com')?.params['PARTSTAT'])
      .toBe('ACCEPTED');
  });

  it('returns null for a line with no colon', () => {
    expect(parseLine('BEGIN')).toBeNull();
  });
});

describe('reading an instant', () => {
  it('reads the UTC form', () => {
    expect(parseIcsDate('20261014T093000Z')?.toISOString()).toBe('2026-10-14T09:30:00.000Z');
  });

  it('reads a floating time as UTC rather than guessing a zone', () => {
    // Guessing the local zone would silently shift other people's meetings.
    expect(parseIcsDate('20261014T093000')?.toISOString()).toBe('2026-10-14T09:30:00.000Z');
  });

  it('reads a date-only value', () => {
    expect(parseIcsDate('20261014')?.toISOString()).toBe('2026-10-14T00:00:00.000Z');
  });

  it('refuses nonsense rather than returning an invalid date', () => {
    expect(parseIcsDate('not-a-date')).toBeNull();
    expect(parseIcsDate('')).toBeNull();
  });
});

describe('a calendar document', () => {
  it('is CRLF-terminated, as the spec requires', () => {
    const ics = buildCalendar([meeting], 'REQUEST');
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/);
  });

  it('carries the method, which is what makes it an invitation', () => {
    expect(buildCalendar([meeting], 'REQUEST')).toContain('METHOD:REQUEST');
  });

  it('omits the method for a plain calendar file', () => {
    expect(buildCalendar([meeting])).not.toContain('METHOD:');
  });

  it('writes the organiser and attendees as mailto', () => {
    // Unfolded first: an attendee line with a display name and parameters is
    // comfortably past 75 octets, so it arrives folded.
    const ics = unfold(buildCalendar([meeting], 'REQUEST')).join('|');
    expect(ics).toContain('ORGANIZER;CN=Poppy:mailto:poppy@example.com');
    expect(ics).toContain('mailto:paul@example.com');
    expect(ics).toContain('PARTSTAT=NEEDS-ACTION');
  });

  it('asks for an answer unless told not to', () => {
    expect(unfold(buildCalendar([meeting], 'REQUEST')).join('|')).toContain('RSVP=TRUE');
    const fyi = { ...meeting, attendees: [{ email: 'a@b.c', status: 'NEEDS-ACTION' as const, rsvp: false }] };
    expect(unfold(buildCalendar([fyi], 'REQUEST')).join('|')).not.toContain('RSVP=TRUE');
  });
});

describe('reading back what we wrote', () => {
  it('round-trips an event', () => {
    const { events, method } = parseCalendar(buildCalendar([meeting], 'REQUEST'));

    expect(method).toBe('REQUEST');
    expect(events).toHaveLength(1);
    const back = events[0]!;
    expect(back.uid).toBe(meeting.uid);
    expect(back.summary).toBe(meeting.summary);
    expect(back.start.toISOString()).toBe(meeting.start.toISOString());
    expect(back.end.toISOString()).toBe(meeting.end.toISOString());
    expect(back.organiser?.email).toBe('poppy@example.com');
    expect(back.attendees?.[0]?.email).toBe('paul@example.com');
  });

  it('round-trips text that needs escaping', () => {
    const awkward: CalendarEvent = {
      ...meeting,
      summary: 'Costs, risks; and "scope"',
      description: 'Line one\nLine two \\ backslash',
      location: 'Room 1, Floor 2',
    };
    const back = parseCalendar(buildCalendar([awkward])).events[0]!;

    expect(back.summary).toBe(awkward.summary);
    expect(back.description).toBe(awkward.description);
    expect(back.location).toBe(awkward.location);
  });

  it('round-trips a summary long enough to fold', () => {
    const long = { ...meeting, summary: 'Quarterly planning for '.repeat(10).trim() };
    expect(parseCalendar(buildCalendar([long])).events[0]!.summary).toBe(long.summary);
  });

  it('round-trips several events in one document', () => {
    const second = { ...meeting, uid: 'def-456@hats', summary: 'Retro' };
    const { events } = parseCalendar(buildCalendar([meeting, second]));

    expect(events.map((e) => e.summary)).toEqual(['Sprint planning', 'Retro']);
  });
});

describe('reading what other people send', () => {
  /** Shaped the way Google writes one, folded lines and all. */
  const googleRequest = [
    'BEGIN:VCALENDAR', 'PRODID:-//Google Inc//Google Calendar 70.9054//EN', 'VERSION:2.0',
    'CALSCALE:GREGORIAN', 'METHOD:REQUEST', 'BEGIN:VEVENT',
    'DTSTART:20261020T140000Z', 'DTEND:20261020T150000Z', 'DTSTAMP:20261014T080000Z',
    'UID:4kc1s2q3@google.com',
    'ORGANIZER;CN=Paul Cox:mailto:paul@example.com',
    'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE',
    ' ;CN=Poppy;X-NUM-GUESTS=0:mailto:poppy@example.com',
    'CREATED:20261014T075900Z', 'LAST-MODIFIED:20261014T075900Z', 'SEQUENCE:0',
    'STATUS:CONFIRMED', 'SUMMARY:Design review', 'TRANSP:OPAQUE',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');

  it('reads a Google invitation, folded attendee line and all', () => {
    const { method, events } = parseCalendar(googleRequest);

    expect(method).toBe('REQUEST');
    expect(events[0]?.summary).toBe('Design review');
    expect(events[0]?.organiser?.email).toBe('paul@example.com');
    expect(events[0]?.attendees?.[0]?.email).toBe('poppy@example.com');
    expect(events[0]?.attendees?.[0]?.name).toBe('Poppy');
  });

  it('ignores properties it does not know about', () => {
    expect(parseCalendar(googleRequest).events).toHaveLength(1);
  });

  it('reads a reply and the answer in it', () => {
    const reply = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'METHOD:REPLY', 'BEGIN:VEVENT',
      'UID:abc-123@hats', 'SUMMARY:Sprint planning',
      'DTSTART:20261014T093000Z', 'DTEND:20261014T103000Z', 'DTSTAMP:20261014T093500Z',
      'ATTENDEE;PARTSTAT=ACCEPTED;CN=Paul:mailto:paul@example.com',
      'SEQUENCE:0', 'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');

    const { method, events } = parseCalendar(reply);
    expect(method).toBe('REPLY');
    expect(events[0]?.attendees?.[0]?.status).toBe('ACCEPTED');
  });

  it('gives an event with no end the hour everyone assumes', () => {
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:x@y',
      'SUMMARY:Open ended', 'DTSTART:20261014T090000Z', 'DTSTAMP:20261014T080000Z',
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');

    const event = parseCalendar(ics).events[0]!;
    expect(event.end.getTime() - event.start.getTime()).toBe(3_600_000);
  });

  it('skips a malformed event rather than losing the rest of the message', () => {
    // One bad invitation should not cost the agent its whole inbox.
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0',
      'BEGIN:VEVENT', 'SUMMARY:No uid and no start', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:good@hats', 'SUMMARY:Fine',
      'DTSTART:20261014T090000Z', 'DTEND:20261014T100000Z', 'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const { events } = parseCalendar(ics);
    expect(events).toHaveLength(1);
    expect(events[0]?.summary).toBe('Fine');
  });

  it('copes with LF-only line endings, which plenty of senders produce', () => {
    const { events } = parseCalendar(googleRequest.replace(/\r\n/g, '\n'));
    expect(events[0]?.summary).toBe('Design review');
  });

  it('returns nothing, rather than throwing, for something that is not a calendar', () => {
    expect(parseCalendar('Dear Poppy,\n\nAre you free on Tuesday?\n').events).toEqual([]);
    expect(parseCalendar('').events).toEqual([]);
  });
});
