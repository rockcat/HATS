/**
 * Cron expressions — run at set times rather than every so often.
 *
 * The standard five fields: minute hour day-of-month month day-of-week.
 * Each takes `*`, a number, a range `a-b`, a step `*\/n` or `a-b/n`, or a
 * comma list of those. Months and days can be named (jan, mon). Day 0 and 7
 * are both Sunday. As in cron, when both day fields are restricted a time
 * matching either one runs.
 *
 * Times are the process's local time, so set TZ for the container.
 */

interface Field { min: number; max: number; names?: string[] }

const FIELDS: Field[] = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12, names: ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] },
  { min: 0, max: 7, names: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] },
];
const FIELD_NAMES = ['minute', 'hour', 'day of month', 'month', 'day of week'];

export interface CronSchedule {
  minutes: Set<number>;
  hours: Set<number>;
  days: Set<number>;
  months: Set<number>;
  weekdays: Set<number>;
  /** Whether the day-of-month and day-of-week fields were each left as `*`. */
  anyDay: boolean;
  anyWeekday: boolean;
}

function value(text: string, field: Field, name: string): number {
  const named = field.names?.indexOf(text.toLowerCase()) ?? -1;
  const n = named >= 0 ? named + (field.min === 1 ? 1 : 0) : Number(text);
  if (!Number.isInteger(n) || n < field.min || n > field.max) {
    throw new Error(`"${text}" is not a valid ${name} (${field.min}–${field.max})`);
  }
  return n;
}

function parseField(text: string, field: Field, name: string): Set<number> {
  const out = new Set<number>();
  for (const part of text.split(',')) {
    const [range, stepText] = part.split('/');
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw new Error(`"${part}" has a bad step in the ${name}`);
    let lo = field.min, hi = field.max;
    if (range !== '*') {
      const [a, b] = range!.split('-');
      lo = value(a!, field, name);
      hi = b === undefined ? (stepText === undefined ? lo : field.max) : value(b, field, name);
      if (hi < lo) throw new Error(`"${part}" runs backwards in the ${name}`);
    }
    for (let n = lo; n <= hi; n += step) out.add(n);
  }
  return out;
}

/** Parse an expression, or throw saying what is wrong with it. */
export function parseCron(expr: string): CronSchedule {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('A cron expression has five fields: minute hour day month weekday');
  const sets = parts.map((p, i) => parseField(p, FIELDS[i]!, FIELD_NAMES[i]!));
  const weekdays = sets[4]!;
  if (weekdays.delete(7)) weekdays.add(0);
  return {
    minutes: sets[0]!, hours: sets[1]!, days: sets[2]!, months: sets[3]!, weekdays,
    anyDay: parts[2] === '*', anyWeekday: parts[4] === '*',
  };
}

/** The reason an expression is invalid, or null if it is fine. */
export function cronError(expr: string): string | null {
  try { parseCron(expr); return null; } catch (err) { return (err as Error).message; }
}

function dayMatches(s: CronSchedule, d: Date): boolean {
  const byDate = s.days.has(d.getDate());
  const byWeekday = s.weekdays.has(d.getDay());
  if (s.anyDay && s.anyWeekday) return true;
  if (s.anyDay) return byWeekday;
  if (s.anyWeekday) return byDate;
  return byDate || byWeekday;
}

/** Look this far ahead before giving up — Feb 30th never comes. */
const HORIZON_DAYS = 366 * 5;

/** The first time after `after` (ms) that the expression matches, in ms; null if it never does. */
export function nextCronRun(expr: string, after: number): number | null {
  const s = parseCron(expr);
  const t = new Date(after);
  t.setSeconds(0, 0);
  t.setMinutes(t.getMinutes() + 1);
  const limit = after + HORIZON_DAYS * 86_400_000;
  while (t.getTime() <= limit) {
    if (!s.months.has(t.getMonth() + 1) || !dayMatches(s, t)) {
      t.setDate(t.getDate() + 1);
      t.setHours(0, 0, 0, 0);
      continue;
    }
    if (!s.hours.has(t.getHours())) {
      t.setHours(t.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!s.minutes.has(t.getMinutes())) {
      t.setMinutes(t.getMinutes() + 1, 0, 0);
      continue;
    }
    return t.getTime();
  }
  return null;
}
