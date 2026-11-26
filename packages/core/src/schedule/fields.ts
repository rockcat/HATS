/**
 * Placeholders in a scheduled prompt, filled in when it fires.
 *
 * A prompt written once runs for weeks, so "today" has to be worked out at
 * the time it runs, not when it was written. The same ${name} form as the
 * ${result} in a tool call's message.
 */

/** What is known about who a scheduled prompt is for. */
export interface ScheduleFieldValues {
  /** The project's human. */
  human?: string;
  /** The agent's own email address. */
  email?: string;
}

/** The placeholders, for the form that explains them. */
export const SCHEDULE_FIELDS = [
  { name: 'date',  description: "today's date, e.g. 2026-11-02" },
  { name: 'time',  description: 'the time it fired, e.g. 09:30' },
  { name: 'human', description: "the human's name" },
  { name: 'email', description: "the agent's email address" },
] as const;

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * The prompt with its placeholders filled. Local time — the same clock the
 * cron times use. A placeholder with no value, or one not in the list, is
 * left as written rather than silently emptied.
 */
export function fillScheduleFields(text: string, values: ScheduleFieldValues, now: Date): string {
  const known: Record<string, string | undefined> = {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    human: values.human,
    email: values.email,
  };
  return text.replace(/\$\{(\w+)\}/g, (whole, name: string) => known[name] || whole);
}
