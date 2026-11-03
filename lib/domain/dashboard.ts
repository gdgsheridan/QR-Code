// SPEC §11 / §13 dashboard rules. Pure: `now` is a parameter.

const THIRTY_MIN_MS = 30 * 60 * 1000;

// §11: warn if within 30 min of starts_at and the door is closed (and keep warning until it opens
// or the event ends). No door checkpoint counts as closed.
export function doorClosedWarning(input: { now: Date; startsAt: string; endsAt: string; doorOpen: boolean }): boolean {
  const now = input.now.getTime();
  return !input.doorOpen && now >= Date.parse(input.startsAt) - THIRTY_MIN_MS && now < Date.parse(input.endsAt);
}

// §13: buckets are computed in UTC and only *labelled* in the event timezone, so the repeated
// 01:00–02:00 hour on DST day shows as two distinct labels (EDT, then EST).
export function bucketLabel(utcIso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(utcIso));
}

// Keep UTC bucket order; show local days when a time alone would look out of order.
export function arrivalLabels(buckets: string[], timeZone: string, minutes = 15): { axis: string; detail: string }[] {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const multiDay = new Set(buckets.map(utc => date.format(new Date(utc)))).size > 1;
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' });
  const time = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });
  return buckets.map(utc => {
    const start = new Date(utc);
    const end = new Date(start.getTime() + minutes * 60_000);
    const endDay = date.format(start) === date.format(end) ? '' : `${weekday.format(end)} `;
    return {
      axis: `${multiDay ? `${weekday.format(start)} ` : ''}${time.format(start)}`,
      detail: `${weekday.format(start)} ${bucketLabel(utc, timeZone)}–${endDay}${bucketLabel(end.toISOString(), timeZone)}`,
    };
  });
}
