// SPEC §11 / §13 dashboard rules. Pure: `now` is a parameter.

import { toSearchText } from './normalize';

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

// §13 (v0.11.36): accepted hackers' free-text dietary notes (from the Sheet), grouped by keyword for catering.
// A note can be in several groups; one in none is "other", unless it's blank or says there's nothing.
const DIET_GROUPS: Array<[label: string, pattern: RegExp]> = [
  ['Vegetarian', /(?<!\bnon )\b(vegetarian|veggie|veg)\b/],
  ['Vegan', /\bvegan\b/],
  ['Pescatarian', /\bpesc[ae]tarian\b/],
  ['Halal', /\bhalal\b/],
  ['Kosher', /\bkosher\b/],
  ['Gluten-free', /\b(gluten|celiac|coeliac)\b/],
  ['Dairy-free', /\b(dairy|lactose|milk)\b/],
  ['Nuts', /\b(nuts?|peanuts?|almonds?|cashews?)\b/],
  ['Seafood/shellfish', /\b(seafood|shellfish|fish|shrimp|crustaceans?)\b/],
  ['No pork', /\bpork\b/],
  ['No beef', /\bbeef\b/],
  ['Eggs', /\beggs?\b/],
];
const NO_RESTRICTION = /^(no|none|nope|nil|nothing|na|n a|not applicable|non veg|non vegetarian)( (dietary )?(restrictions?|allergies))?$/;

export interface DietaryBreakdown {
  total: number;
  none: number;
  other: number;
  groups: Array<{ label: string; count: number }>;
}

/** v0.11.39: the groups one note falls in (Catering lists, meal scan tags). */
export function dietaryGroups(note: string | null): string[] {
  const text = toSearchText(note ?? '');
  return DIET_GROUPS.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
}

/** Blank, or "none", "N/A" and the like. */
export function noRestriction(note: string | null): boolean {
  const text = toSearchText(note ?? '');
  return text === '' || NO_RESTRICTION.test(text);
}

export function dietaryBreakdown(notes: Array<string | null>): DietaryBreakdown {
  const counts = new Map<string, number>();
  let none = 0;
  let other = 0;
  for (const note of notes) {
    const hits = dietaryGroups(note);
    for (const label of hits) counts.set(label, (counts.get(label) ?? 0) + 1);
    if (hits.length === 0) {
      if (noRestriction(note)) none += 1;
      else other += 1;
    }
  }
  const groups = [...counts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'en'));
  return { total: notes.length, none, other, groups };
}
