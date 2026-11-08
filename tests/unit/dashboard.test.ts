import { describe, expect, it } from 'vitest';
import { bucketLabel, dietaryBreakdown, dietaryGroups, noRestriction } from '@/lib/domain/dashboard';

describe('dashboard rules (SPEC §11, §13)', () => {
  it('T-ANA-03: 01:00–02:00 on 2026-11-01 in Toronto gets two distinct labels (EDT, then EST)', () => {
    expect(bucketLabel('2026-11-01T05:00:00Z', 'America/Toronto')).toBe('1:00 AM EDT');
    expect(bucketLabel('2026-11-01T06:00:00Z', 'America/Toronto')).toBe('1:00 AM EST');
    expect(bucketLabel('2026-11-01T05:15:00Z', 'America/Toronto')).toBe('1:15 AM EDT');
  });
});

it('T-ADM-06: arrival labels distinguish local dates and preserve DST offsets in ranges', async () => {
  const { arrivalLabels } = await import('@/lib/domain/dashboard');
  const labels = arrivalLabels(['2026-11-08T02:15:00Z', '2026-11-09T00:30:00Z'], 'America/Toronto');
  expect(labels.map(l => l.axis)).toEqual(['Sat 9:15 PM', 'Sun 7:30 PM']);
  expect(labels[1]?.detail).toContain('Sun 7:30');
  expect(labels[1]?.detail).toContain('7:45 PM EST');
  const dst = arrivalLabels(['2026-11-01T05:45:00Z'], 'America/Toronto');
  expect(dst[0]?.detail).toContain('1:45 AM EDT');
  expect(dst[0]?.detail).toContain('1:00 AM EST');
});

it('T-ANA-07: dietary notes are grouped by keyword; a note can be in several groups; blank and "none" mean no restriction', () => {
  const notes = ['Vegetarian', 'VEGAN', 'Halal, no pork', 'Gluten free / celiac', 'lactose intolerant', 'Peanuts!', 'Végétarian', 'veg',
    'N/A', 'None.', '', null, 'Non-vegetarian', 'No dietary restrictions', 'low FODMAP'];
  expect(dietaryBreakdown(notes)).toEqual({
    total: 15,
    none: 6, // N/A, None., '', null, Non-vegetarian, No dietary restrictions
    other: 1, // low FODMAP
    groups: [
      { label: 'Vegetarian', count: 3 },
      { label: 'Dairy-free', count: 1 },
      { label: 'Gluten-free', count: 1 },
      { label: 'Halal', count: 1 },
      { label: 'No pork', count: 1 },
      { label: 'Nuts', count: 1 },
      { label: 'Vegan', count: 1 },
    ],
  });
  expect(dietaryBreakdown([])).toEqual({ total: 0, none: 0, other: 0, groups: [] });
  // v0.11.39: one note's groups (Catering lists, meal scan tags), and whether it means no restriction.
  expect(dietaryGroups('Halal, no pork')).toEqual(['Halal', 'No pork']);
  expect(dietaryGroups('Vegan, nut allergy')).toEqual(['Vegan', 'Nuts']);
  expect(dietaryGroups('N/A')).toEqual([]);
  expect(dietaryGroups('low FODMAP')).toEqual([]);
  expect(dietaryGroups(null)).toEqual([]);
  expect([noRestriction('None.'), noRestriction(''), noRestriction(null), noRestriction('low FODMAP'), noRestriction('Halal')]).toEqual([true, true, true, false, false]);
});

it('T-LB-05: labels follow the bucket length: an hourly bucket ends an hour later, also across the DST change', async () => {
  const { arrivalLabels } = await import('@/lib/domain/dashboard');
  const [hour] = arrivalLabels(['2026-11-08T14:00:00Z'], 'America/Toronto', 60);
  expect(hour?.detail).toContain('9:00 AM EST');
  expect(hour?.detail).toContain('10:00 AM EST');
  const [dst] = arrivalLabels(['2026-11-01T05:00:00Z'], 'America/Toronto', 60);
  expect(dst?.detail).toContain('1:00 AM EDT');
  expect(dst?.detail).toContain('1:00 AM EST'); // 01:00–02:00 happens twice (§13)
});
