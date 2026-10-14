// ── Reading and writing iCalendar ─────────────────────────────────────────────
//
// RFC 5545, enough of it for VEVENT and for the invitation exchange in RFC
// 6047: a REQUEST carries the meeting, a REPLY carries one person's answer, a
// CANCEL calls it off.
//
// Written by hand rather than pulled from a package because the surface we
// need is small and the failure mode of getting it subtly wrong — an
// invitation that Outlook silently ignores — is one you only find by testing
// against real messages. Those tests are easier to write against code we own.
//
// The fiddly parts of the format, all of which have bitten real
// implementations: lines fold at 75 octets and continue with a single leading
// space; TEXT values escape backslash, semicolon, comma and newline; property
// names carry parameters before the colon, and a parameter value may itself be
// quoted and contain a colon.

import type { Attendee, Calendar, CalendarEvent, CalendarMethod, Participation } from './types.js';

const PRODID = '-//HATS//Agent Calendar//EN';
const PARTSTATS: Participation[] = ['NEEDS-ACTION', 'ACCEPTED', 'DECLINED', 'TENTATIVE'];

// ── Writing ──────────────────────────────────────────────────────────────────

/** An instant as iCalendar UTC: 20261014T093000Z. */
export function formatUtc(date: Date): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`
    + `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

/** Escape a TEXT value. Order matters: backslashes first, or we escape our own. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\n|\r/g, '\\n');
}

export function unescapeText(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== '\\') { out += value[i]; continue; }
    const next = value[++i];
    out += next === 'n' || next === 'N' ? '\n' : (next ?? '');
  }
  return out;
}

/**
 * Fold a content line to 75 octets.
 *
 * Octets, not characters: a line split through the middle of a multi-byte
 * character produces a file that some parsers reject and others render as
 * mojibake, and an agent's summary may well contain one.
 */
export function foldLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;

  const parts: string[] = [];
  let at = 0;
  let limit = 75;
  while (at < bytes.length) {
    let take = Math.min(limit, bytes.length - at);
    // Do not split a multi-byte sequence: continuation bytes are 10xxxxxx.
    while (take > 1 && at + take < bytes.length && (bytes[at + take]! & 0xc0) === 0x80) take--;
    parts.push(bytes.subarray(at, at + take).toString('utf8'));
    at += take;
    limit = 74; // continuation lines carry a leading space
  }
  return parts.join('\r\n ');
}

const property = (name: string, value: string, params: Record<string, string> = {}) => {
  const rendered = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `;${k}=${/[;:,]/.test(v) ? `"${v}"` : v}`)
    .join('');
  return foldLine(`${name}${rendered}:${value}`);
};

const personParams = (name: string | undefined, extra: Record<string, string> = {}) =>
  ({ ...(name ? { CN: name } : {}), ...extra });

/** One VEVENT block, without the surrounding VCALENDAR. */
export function buildVEvent(event: CalendarEvent): string[] {
  const lines = [
    'BEGIN:VEVENT',
    property('UID', event.uid),
    property('DTSTAMP', formatUtc(event.stamp ?? new Date())),
    property('DTSTART', formatUtc(event.start)),
    property('DTEND', formatUtc(event.end)),
    property('SUMMARY', escapeText(event.summary)),
  ];

  if (event.description) lines.push(property('DESCRIPTION', escapeText(event.description)));
  if (event.location) lines.push(property('LOCATION', escapeText(event.location)));
  if (event.organiser) {
    lines.push(property('ORGANIZER', `mailto:${event.organiser.email}`,
      personParams(event.organiser.name)));
  }

  for (const attendee of event.attendees ?? []) {
    lines.push(property('ATTENDEE', `mailto:${attendee.email}`, personParams(attendee.name, {
      PARTSTAT: attendee.status,
      ROLE: 'REQ-PARTICIPANT',
      ...(attendee.rsvp === false ? {} : { RSVP: 'TRUE' }),
    })));
  }

  lines.push(property('SEQUENCE', String(event.sequence ?? 0)));
  lines.push(property('STATUS', event.status ?? 'CONFIRMED'));
  lines.push('END:VEVENT');
  return lines;
}

/** A complete iCalendar document, CRLF-terminated as the spec requires. */
export function buildCalendar(events: CalendarEvent[], method?: CalendarMethod): string {
  const lines = [
    'BEGIN:VCALENDAR',
    property('PRODID', PRODID),
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    ...(method ? [property('METHOD', method)] : []),
    ...events.flatMap(buildVEvent),
    'END:VCALENDAR',
  ];
  return lines.join('\r\n') + '\r\n';
}

// ── Reading ──────────────────────────────────────────────────────────────────

/** Undo line folding. A continuation is a line starting with space or tab. */
export function unfold(text: string): string[] {
  const lines: string[] = [];
  for (const raw of text.split(/\r\n|\n|\r/)) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += raw.slice(1);
    } else if (raw.length > 0) {
      lines.push(raw);
    }
  }
  return lines;
}

interface ParsedLine {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** Split `NAME;PARAM=x;OTHER="a:b":value` without tripping on a quoted colon. */
export function parseLine(line: string): ParsedLine | null {
  let colon = -1;
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === ':' && !quoted) { colon = i; break; }
  }
  if (colon < 0) return null;

  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);

  const parts: string[] = [];
  let current = '';
  quoted = false;
  for (const ch of head) {
    if (ch === '"') { quoted = !quoted; continue; }
    if (ch === ';' && !quoted) { parts.push(current); current = ''; continue; }
    current += ch;
  }
  parts.push(current);

  const params: Record<string, string> = {};
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=');
    if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  return { name: (parts[0] ?? '').toUpperCase(), params, value };
}

/**
 * An iCalendar instant.
 *
 * Handles the UTC form, the floating form (no Z), and the date-only form used
 * by all-day events. A floating time is read as UTC: without the VTIMEZONE
 * block it refers to there is nothing better to do, and guessing the local
 * zone would silently shift other people's meetings.
 */
export function parseIcsDate(value: string): Date | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h = '0', mi = '0', s = '0'] = match;
  return new Date(Date.UTC(+y!, +mo! - 1, +d!, +h, +mi, +s));
}

const emailOf = (value: string) => value.replace(/^mailto:/i, '').trim();

const partstatOf = (value: string | undefined): Participation => {
  const upper = (value ?? '').toUpperCase() as Participation;
  return PARTSTATS.includes(upper) ? upper : 'NEEDS-ACTION';
};

/**
 * Parse an iCalendar document.
 *
 * Lenient on purpose: this reads messages written by Google, Outlook, Apple
 * and whatever else an agent is sent. An event missing something we need is
 * skipped rather than throwing, because one malformed invitation should not
 * cost the agent the rest of its inbox.
 */
export function parseCalendar(text: string): Calendar {
  const events: CalendarEvent[] = [];
  let method: CalendarMethod | undefined;
  let current: Partial<CalendarEvent> & { attendees: Attendee[] } | null = null;

  for (const line of unfold(text)) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    const { name, params, value } = parsed;

    if (name === 'BEGIN' && value.toUpperCase() === 'VEVENT') {
      current = { attendees: [] };
      continue;
    }
    if (name === 'END' && value.toUpperCase() === 'VEVENT') {
      // DTEND is optional in iCalendar. Requiring it here dropped the whole
      // event, which is a worse answer than assuming the hour everyone means.
      if (current?.uid && current.start && current.summary !== undefined) {
        events.push({
          ...current,
          summary: current.summary,
          end: current.end ?? new Date(current.start.getTime() + 3_600_000),
        } as CalendarEvent);
      }
      current = null;
      continue;
    }

    if (!current) {
      if (name === 'METHOD') method = value.toUpperCase() as CalendarMethod;
      continue;
    }

    switch (name) {
      case 'UID':         current.uid = value; break;
      case 'SUMMARY':     current.summary = unescapeText(value); break;
      case 'DESCRIPTION': current.description = unescapeText(value); break;
      case 'LOCATION':    current.location = unescapeText(value); break;
      case 'DTSTART':     current.start = parseIcsDate(value) ?? undefined; break;
      case 'DTEND':       current.end = parseIcsDate(value) ?? undefined; break;
      case 'DTSTAMP':     current.stamp = parseIcsDate(value) ?? undefined; break;
      case 'SEQUENCE':    current.sequence = Number(value) || 0; break;
      case 'STATUS':      current.status = value.toUpperCase() as CalendarEvent['status']; break;
      case 'ORGANIZER':
        current.organiser = { email: emailOf(value), ...(params['CN'] ? { name: params['CN'] } : {}) };
        break;
      case 'ATTENDEE':
        current.attendees.push({
          email: emailOf(value),
          ...(params['CN'] ? { name: params['CN'] } : {}),
          status: partstatOf(params['PARTSTAT']),
          rsvp: (params['RSVP'] ?? '').toUpperCase() !== 'FALSE',
        });
        break;
      default: break;
    }
  }


  return { ...(method ? { method } : {}), events };
}
