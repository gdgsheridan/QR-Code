import { describe, expect, it } from 'vitest';
import { MAX_RATE_LIMIT_RETRIES, nextAttempt, sanitizeError } from '@/lib/domain/outbox';

const now = new Date('2026-10-03T12:00:00Z');
const later = (s: number) => new Date(now.getTime() + s * 1000);

describe('outbox retry policy (SPEC F4)', () => {
  it('T-MAIL-03: backoff 1 min, 5 min, 25 min, 2 h, then failed after 5 attempts', () => {
    expect(nextAttempt({ attempts: 1, now })).toEqual({ status: 'pending', at: later(60) });
    expect(nextAttempt({ attempts: 2, now })).toEqual({ status: 'pending', at: later(300) });
    expect(nextAttempt({ attempts: 3, now })).toEqual({ status: 'pending', at: later(1500) });
    expect(nextAttempt({ attempts: 4, now })).toEqual({ status: 'pending', at: later(7200) });
    expect(nextAttempt({ attempts: 5, now })).toEqual({ status: 'failed' });
    expect(nextAttempt({ attempts: 9, now })).toEqual({ status: 'failed' });
  });

  it('T-MAIL-04: Retry-After overrides the backoff table', () => {
    expect(nextAttempt({ attempts: 1, now, retryAfterSeconds: 120 })).toEqual({ status: 'pending', at: later(120) });
    expect(nextAttempt({ attempts: 5, now, retryAfterSeconds: 120 })).toEqual({ status: 'failed' });
  });

  it('T-MAIL-15: a 429 is not a failed attempt; only 20 rate-limited tries in a row give up', () => {
    // attempts already counts this try, but a rate-limited one is handed back (finish_outbox refunds it).
    expect(nextAttempt({ attempts: 5, now, retryAfterSeconds: 120, rateLimitHits: 1 })).toEqual({ status: 'pending', at: later(120) });
    expect(nextAttempt({ attempts: 1, now, rateLimitHits: 19 })).toEqual({ status: 'pending', at: later(60) });
    expect(nextAttempt({ attempts: 1, now, rateLimitHits: MAX_RATE_LIMIT_RETRIES })).toEqual({ status: 'failed' });
  });

  it('T-MAIL-03: last_error has no email address or token, and is at most 500 chars', () => {
    const err = Object.assign(new Error(`rejected ada.l+x@Gmail.com token Ab3_-xYz0123456789abcdefGHIJKLMN ${'z'.repeat(900)}`), {
      status: 500,
    });
    const s = sanitizeError(err);
    expect(s).toMatch(/^HTTP 500/);
    expect(s).not.toMatch(/@/);
    expect(s).not.toContain('Ab3_-xYz0123456789abcdefGHIJKLMN');
    expect(s.length).toBeLessThanOrEqual(500);
    expect(sanitizeError('weird')).toBe('Error: weird');
  });
});
