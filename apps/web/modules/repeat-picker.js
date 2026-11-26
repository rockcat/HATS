// ── How a scheduled task repeats ───────────────────────────────────────────────
//
// Once, every so many minutes, or at set times. Set times are stored as a cron
// expression; the common ones — daily, weekdays, weekly — get a time and day
// picker, and anything else can be typed as cron. Times are the runner's
// local time (TZ in docker-compose).

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = n => String(n).padStart(2, '0');

/** A cron expression the pickers made, read back: { kind, time, day }; null when it is something else. */
export function readCron(cron) {
  const m = /^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5|[0-6])$/.exec(cron?.trim() ?? '');
  if (!m) return null;
  const time = `${pad(m[2])}:${pad(m[1])}`;
  if (m[3] === '*') return { kind: 'daily', time };
  if (m[3] === '1-5') return { kind: 'weekdays', time };
  return { kind: 'weekly', time, day: Number(m[3]) };
}

/** The cron expression for a picked time: 'HH:MM', and a day (0 = Sunday) for weekly. */
export function makeCron(kind, time, day = 1) {
  const [h, mi] = (time || '09:00').split(':').map(Number);
  const dow = kind === 'weekdays' ? '1-5' : kind === 'weekly' ? String(day) : '*';
  return `${mi} ${h} * * ${dow}`;
}

/** How a task repeats, in words. */
export function repeatText({ intervalSeconds, cron } = {}) {
  if (cron) {
    const known = readCron(cron);
    if (!known) return `Cron ${cron}`;
    if (known.kind === 'daily') return `Daily at ${known.time}`;
    if (known.kind === 'weekdays') return `Weekdays at ${known.time}`;
    return `${DAYS[known.day]}s at ${known.time}`;
  }
  if (!intervalSeconds) return 'Once';
  const mins = Math.round(intervalSeconds / 60);
  return mins >= 60 && mins % 60 === 0 ? `Every ${mins / 60} h` : `Every ${mins} min`;
}

/**
 * A repeat picker. `set({ intervalSeconds, cron })` shows a task's repeat;
 * `read()` gives `{ intervalMinutes, cron }` for the API, with `cron: null`
 * clearing one.
 */
export function repeatPicker() {
  const el = document.createElement('div');
  el.className = 'repeat-picker';
  el.innerHTML = `
    <select class="schedules-input repeat-kind" aria-label="Repeat">
      <option value="once">Once</option>
      <option value="interval">Every…</option>
      <option value="daily">Daily at…</option>
      <option value="weekdays">Weekdays at…</option>
      <option value="weekly">Weekly on…</option>
      <option value="cron">Cron expression…</option>
    </select>
    <span class="repeat-part" data-for="interval"><input type="number" class="schedules-input repeat-minutes" min="1" step="1" placeholder="60"> min</span>
    <select class="schedules-input repeat-day" data-for="weekly">${DAYS.map((d, i) => `<option value="${i}">${d}</option>`).join('')}</select>
    <input type="time" class="schedules-input repeat-time" data-for="daily weekdays weekly" value="09:00">
    <input type="text" class="schedules-input repeat-cron" data-for="cron" placeholder="min hour day month weekday — e.g. 30 8 * * 1-5" spellcheck="false">`;
  const $ = sel => el.querySelector(sel);

  const show = () => {
    const kind = $('.repeat-kind').value;
    for (const part of el.querySelectorAll('[data-for]')) part.hidden = !part.dataset.for.split(' ').includes(kind);
  };
  $('.repeat-kind').addEventListener('change', show);

  return {
    el,
    set({ intervalSeconds, cron } = {}) {
      const known = cron ? readCron(cron) : null;
      $('.repeat-kind').value = cron ? (known?.kind ?? 'cron') : intervalSeconds ? 'interval' : 'once';
      $('.repeat-minutes').value = intervalSeconds ? String(Math.round(intervalSeconds / 60)) : '';
      $('.repeat-time').value = known?.time ?? '09:00';
      $('.repeat-day').value = String(known?.day ?? 1);
      $('.repeat-cron').value = cron ?? '';
      show();
    },
    read() {
      const kind = $('.repeat-kind').value;
      if (kind === 'interval') {
        const mins = parseInt($('.repeat-minutes').value, 10);
        if (!(mins > 0)) throw new Error('Enter how many minutes between runs');
        return { intervalMinutes: mins, cron: null };
      }
      if (kind === 'cron') {
        const cron = $('.repeat-cron').value.trim();
        if (!cron) throw new Error('Enter a cron expression');
        return { intervalMinutes: null, cron };
      }
      if (kind === 'once') return { intervalMinutes: null, cron: null };
      return { intervalMinutes: null, cron: makeCron(kind, $('.repeat-time').value, Number($('.repeat-day').value)) };
    },
  };
}
