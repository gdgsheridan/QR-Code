import { describe, expect, it } from 'vitest';
import { bucketLabel, doorClosedWarning } from '@/lib/domain/dashboard';

const startsAt = '2026-10-03T13:00:00Z';
const endsAt = '2026-10-03T23:00:00Z';
const at = (iso: string) => new Date(iso);

describe('dashboard rules (SPEC §11, §13)', () => {
  it('T-ADM-06: warns when within 30 min of starts_at and the door is closed, until the event ends', () => {
    expect(doorClosedWarning({ now: at('2026-10-03T12:40:00Z'), startsAt, endsAt, doorOpen: false })).toBe(true);
    expect(doorClosedWarning({ now: at('2026-10-03T12:30:00Z'), startsAt, endsAt, doorOpen: false })).toBe(true);
    expect(doorClosedWarning({ now: at('2026-10-03T12:29:00Z'), startsAt, endsAt, doorOpen: false })).toBe(false);
    expect(doorClosedWarning({ now: at('2026-10-03T14:00:00Z'), startsAt, endsAt, doorOpen: false })).toBe(true);
    expect(doorClosedWarning({ now: at('2026-10-03T12:40:00Z'), startsAt, endsAt, doorOpen: true })).toBe(false);
    expect(doorClosedWarning({ now: at('2026-10-03T23:00:00Z'), startsAt, endsAt, doorOpen: false })).toBe(false);
  });

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

it('T-LB-05: labels follow the bucket length: an hourly bucket ends an hour later, also across the DST change', async () => {
  const { arrivalLabels } = await import('@/lib/domain/dashboard');
  const [hour] = arrivalLabels(['2026-11-08T14:00:00Z'], 'America/Toronto', 60);
  expect(hour?.detail).toContain('9:00 AM EST');
  expect(hour?.detail).toContain('10:00 AM EST');
  const [dst] = arrivalLabels(['2026-11-01T05:00:00Z'], 'America/Toronto', 60);
  expect(dst?.detail).toContain('1:00 AM EDT');
  expect(dst?.detail).toContain('1:00 AM EST'); // 01:00–02:00 happens twice (§13)
});
