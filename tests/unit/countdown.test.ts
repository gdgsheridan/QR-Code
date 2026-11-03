import { describe, expect, it } from 'vitest';
import { formatCountdown, remainingMs } from '@/lib/domain/countdown';

describe('workshop cooldown timer (§8 step 11b)', () => {
  it('T-WS-02: remainingMs and formatCountdown', () => {
    expect(remainingMs('2026-11-07T15:05:00Z', '2026-11-07T15:00:00Z')).toBe(300_000);
    expect(remainingMs('2026-11-07T15:00:00Z', '2026-11-07T15:05:00Z')).toBe(0);
    expect(remainingMs('nope', '2026-11-07T15:00:00Z')).toBe(0);
    expect(remainingMs('2026-11-07T15:00:01Z', Date.parse('2026-11-07T15:00:00Z'))).toBe(1000);
    expect(formatCountdown(300_000)).toBe('5:00');
    expect(formatCountdown(245_000)).toBe('4:05');
    expect(formatCountdown(1)).toBe('0:01');
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(-5)).toBe('0:00');
  });
});
