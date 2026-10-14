// ── What an agent keeps in its calendar ───────────────────────────────────────
//
// Shaped to iCalendar (RFC 5545) rather than to anything convenient, because
// the whole point of this is that other people's calendars understand it. A
// field here maps to a property there, and the few that do not are marked.

/** How an invitee has responded. The iCalendar PARTSTAT values. */
export type Participation = 'NEEDS-ACTION' | 'ACCEPTED' | 'DECLINED' | 'TENTATIVE';

/** Why a message was sent. The iCalendar METHOD values we handle (RFC 6047). */
export type CalendarMethod = 'PUBLISH' | 'REQUEST' | 'REPLY' | 'CANCEL';

export interface Attendee {
  email: string;
  /** Display name, if known. */
  name?: string;
  status: Participation;
  /** Whether their answer is actually wanted, or they are just being told. */
  rsvp?: boolean;
}

export interface CalendarEvent {
  /** Stable across updates and replies — this is what ties a thread together. */
  uid: string;
  summary: string;
  /** Start and end as absolute instants. All-day events are not handled yet. */
  start: Date;
  end: Date;
  description?: string;
  location?: string;
  organiser?: { email: string; name?: string };
  attendees?: Attendee[];
  /** Bumped on every change that invitees need to be told about. */
  sequence?: number;
  /** CANCELLED marks an event called off rather than deleted, so the
   *  cancellation can still be sent to people who have it in their diary. */
  status?: 'CONFIRMED' | 'CANCELLED' | 'TENTATIVE';
  /** When this version of the event was written. */
  stamp?: Date;
}

/** A parsed iCalendar document. */
export interface Calendar {
  method?: CalendarMethod;
  events: CalendarEvent[];
}
