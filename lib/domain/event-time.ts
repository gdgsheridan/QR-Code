// I-8: event times are shown in the event's timezone, never the device's.
// Example: "Sat, Oct 3 · 9:00 AM EDT".
export function formatEventDateTime(at: string | Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).formatToParts(new Date(at));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('weekday')}, ${get('month')} ${get('day')} · ${get('hour')}:${get('minute')} ${get('dayPeriod')} ${get('timeZoneName')}`;
}

// datetime-local value ("2026-10-03T09:00") for an instant, shown in the event timezone (I-8).
export function toLocalInput(at: string | Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(at));
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

// Calendar days from `now` to `at` in the event timezone (I-8): 0 on the day itself, 1 the day before, negative after.
export function daysUntil(at: string | Date, now: Date, timeZone: string): number {
  const day = (d: string | Date) => Date.parse(toLocalInput(d, timeZone).slice(0, 10));
  return (day(at) - day(now)) / 86_400_000;
}

// The UTC offset (ms) that `timeZone` has at `instantMs`.
function offsetAt(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instantMs));
  const n = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) - instantMs;
}

// "2026-11-01T04:00" as a wall-clock time in `timeZone` → the UTC instant (ISO). Two passes, because
// the offset must be read at the answer, not at the naive guess: the two differ across a DST change.
export function zonedToUtc(local: string, timeZone: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) throw new Error(`time must look like 2026-10-03T09:00, got ${local}`);
  const naive = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  const first = naive - offsetAt(naive, timeZone);
  return new Date(naive - offsetAt(first, timeZone)).toISOString();
}
