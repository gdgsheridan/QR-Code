// Workshop cooldown timers (§8 step 11b). Pure: the caller passes both instants.

/** Milliseconds from `now` until `until` (ISO), never negative; 0 for an unparseable time. */
export function remainingMs(until: string, now: string | number): number {
  const end = Date.parse(until);
  const from = typeof now === 'number' ? now : Date.parse(now);
  if (!Number.isFinite(end) || !Number.isFinite(from)) return 0;
  return Math.max(0, end - from);
}

/** "4:05" for 245 s, "0:00" at the end; rounds up so the timer reaches 0:00 only when the wait is over. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
