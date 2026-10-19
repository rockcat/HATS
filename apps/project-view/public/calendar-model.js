// ── Laying out a calendar ─────────────────────────────────────────────────────
//
// No DOM: given the meetings and where the viewer is looking, work out what
// days and what rows to draw. Keeping it pure matters more here than usual,
// because every bug in a calendar is a date bug and date bugs are the ones
// that only show up in a particular week.
//
// Weeks start on Monday, which is what a working week means here and what the
// runner's standups assume. JavaScript disagrees — getDay() calls Sunday 0 —
// and that off-by-one is the classic way a calendar ends up a day out.

export const VIEWS = ['day', 'week', 'agenda'];

export const MEETING_TYPES = [
  { id: 'standup', label: 'Standup' },
  { id: 'sprint_planning', label: 'Sprint Planning' },
  { id: 'retro', label: 'Retro' },
  { id: 'review', label: 'Review' },
  { id: 'ad_hoc', label: 'Ad Hoc' },
];

export const TYPE_LABELS = Object.fromEntries(MEETING_TYPES.map((t) => [t.id, t.label]));

/** The hours a working day is drawn between. */
export const DAY_START_HOUR = 7;
export const DAY_END_HOUR = 21;

/** Midnight at the start of `date`, in local time. */
export function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * The Monday of the week containing `date`.
 *
 * getDay() is 0 for Sunday, so Sunday has to be pulled *back* six days rather
 * than forward one — the single most common way a week view ends up showing
 * the wrong seven days.
 */
export function startOfWeek(date) {
  const d = startOfDay(date);
  const weekday = (d.getDay() + 6) % 7;   // Monday = 0
  d.setDate(d.getDate() - weekday);
  return d;
}

export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** The days a view covers, as midnight-aligned dates. */
export function daysInView(view, focus) {
  if (view === 'week') {
    const monday = startOfWeek(focus);
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  }
  return [startOfDay(focus)];
}

/** Move the focus by one unit of whatever is being viewed. */
export function step(view, focus, direction) {
  if (view === 'week') return addDays(focus, 7 * direction);
  if (view === 'day') return addDays(focus, direction);
  return addDays(focus, 7 * direction);   // agenda pages by the week
}

const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** When a meeting happens, or null if it has no usable date. */
export function whenOf(meeting) {
  const at = Date.parse(meeting?.scheduledFor ?? meeting?.startedAt ?? '');
  return Number.isFinite(at) ? new Date(at) : null;
}

/** The meetings on one day, earliest first. */
export function meetingsOn(meetings, day) {
  return (meetings ?? [])
    .map((m) => ({ meeting: m, when: whenOf(m) }))
    .filter((x) => x.when && sameDay(x.when, day))
    .sort((a, b) => a.when - b.when)
    .map((x) => x.meeting);
}

/**
 * Where a meeting sits in a day column, as fractions of the drawn day.
 *
 * Returns null for a meeting outside the drawn hours rather than clamping it
 * to the edge, so an 03:00 meeting is reported as not shown instead of
 * silently pretending to be at 07:00.
 */
export function placeInDay(meeting, { startHour = DAY_START_HOUR, endHour = DAY_END_HOUR } = {}) {
  const when = whenOf(meeting);
  if (!when) return null;

  const hours = when.getHours() + when.getMinutes() / 60;
  if (hours < startHour || hours >= endHour) return null;

  const span = endHour - startHour;
  const minutes = Number(meeting?.durationMinutes) || 30;
  return {
    top: (hours - startHour) / span,
    height: Math.min(minutes / 60 / span, 1 - (hours - startHour) / span),
  };
}

/** Meetings with no place in the grid, so they can still be listed. */
export function outsideHours(meetings, day, bounds) {
  return meetingsOn(meetings, day).filter((m) => placeInDay(m, bounds) === null);
}

/**
 * Everything upcoming, then everything past, both nearest-first.
 *
 * The agenda is read to answer "what is next", so the next thing leads;
 * history is below it rather than scrolled to.
 */
export function agenda(meetings, now = new Date()) {
  const dated = (meetings ?? [])
    .map((m) => ({ meeting: m, when: whenOf(m) }))
    .filter((x) => x.when);

  const upcoming = dated.filter((x) => x.when >= now).sort((a, b) => a.when - b.when);
  const past = dated.filter((x) => x.when < now).sort((a, b) => b.when - a.when);
  return {
    upcoming: upcoming.map((x) => x.meeting),
    past: past.map((x) => x.meeting),
    undated: (meetings ?? []).filter((m) => !whenOf(m)),
  };
}

/** How the period being viewed should be titled. */
export function titleFor(view, focus) {
  const month = { month: 'long', year: 'numeric' };
  if (view === 'day') {
    return focus.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', ...month });
  }
  if (view === 'week') {
    const monday = startOfWeek(focus);
    const sunday = addDays(monday, 6);
    const sameMonth = monday.getMonth() === sunday.getMonth();
    return `${monday.getDate()} ${sameMonth ? '' : monday.toLocaleDateString(undefined, { month: 'short' })}`
      .trim() + ` – ${sunday.toLocaleDateString(undefined, { day: 'numeric', ...month })}`;
  }
  return 'Everything scheduled';
}

/** Hour labels down the side of a day or week. */
export function hourRows({ startHour = DAY_START_HOUR, endHour = DAY_END_HOUR } = {}) {
  return Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
}

/** A datetime-local value for an input, defaulting to the next whole hour. */
export function defaultMeetingTime(now = new Date()) {
  const when = new Date(now);
  when.setMinutes(0, 0, 0);
  when.setHours(when.getHours() + 1);
  const pad = (n) => String(n).padStart(2, '0');
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`
    + `T${pad(when.getHours())}:${pad(when.getMinutes())}`;
}
