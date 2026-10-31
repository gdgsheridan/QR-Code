// SPEC F4 retry policy. Pure: `now` is a parameter.

const BACKOFF_SECONDS = [60, 5 * 60, 25 * 60, 2 * 60 * 60] as const;
const MAX_BACKOFF_SECONDS = 2 * 60 * 60;
export const MAX_ATTEMPTS = 5;
// v0.11.25: a provider's 429 isn't a failed attempt. Only this many rate-limited tries in a row give up.
// A10: `rateLimitHits` is the CONSECUTIVE count (finish_outbox resets it to 0 on any real non-429
// outcome; a refunded handoff preserves it), so a recovered row starts a fresh streak.
export const MAX_RATE_LIMIT_RETRIES = 20;
const RATE_LIMIT_WAIT_SECONDS = 60;

export type NextAttempt = { status: 'pending'; at: Date } | { status: 'failed' };

/** `rateLimitHits` is set only for a 429: the row's CONSECUTIVE rate-limited tries, this one included. */
export function nextAttempt(input: { attempts: number; now: Date; retryAfterSeconds?: number; rateLimitHits?: number }): NextAttempt {
  if (input.rateLimitHits !== undefined) {
    if (input.rateLimitHits >= MAX_RATE_LIMIT_RETRIES) return { status: 'failed' };
    return { status: 'pending', at: new Date(input.now.getTime() + (input.retryAfterSeconds ?? RATE_LIMIT_WAIT_SECONDS) * 1000) };
  }
  if (input.attempts >= MAX_ATTEMPTS) return { status: 'failed' };
  const table = BACKOFF_SECONDS[Math.max(0, input.attempts - 1)] ?? MAX_BACKOFF_SECONDS;
  const delay = input.retryAfterSeconds ?? table;
  return { status: 'pending', at: new Date(input.now.getTime() + delay * 1000) };
}

const EMAIL = /[^\s@<>"']+@[^\s@<>"']+/g;
const TOKEN_LIKE = /[A-Za-z0-9_-]{32,}/g;

// For outbox.last_error: status + error class/message with emails and token-like runs removed (I-11).
export function sanitizeError(err: unknown): string {
  const status =
    typeof err === 'object' && err !== null && 'status' in err && typeof err.status === 'number' ? err.status : undefined;
  const base = err instanceof Error ? `${err.name}: ${err.message}` : `Error: ${String(err)}`;
  const text = `${status !== undefined ? `HTTP ${status} ` : ''}${base}`
    .replace(EMAIL, '[email]')
    .replace(TOKEN_LIKE, '[redacted]');
  return text.slice(0, 500);
}
